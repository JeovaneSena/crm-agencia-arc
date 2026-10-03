/**
 * Conversa com o banco pelo PostgREST.
 *
 * SEM DEPENDÊNCIA NENHUMA, pelo mesmo motivo da função `agenda/`: este runtime
 * sobe com `--no-remote` e recusa buscar módulo externo no boot — inclusive o
 * `supabase-js`. A função falharia inteira com BOOT_ERROR antes de rodar uma
 * linha. Como tudo que precisamos é falar com o PostgREST, `fetch` resolve.
 *
 * A `service_role key` é entregue automaticamente pelo Supabase às Edge
 * Functions. Ela passa por cima do RLS — a disciplina de só tocar no que está
 * na lista fechada (agente-ia/README.md, seção 7) é do código, não do banco.
 */

const URL_BASE = Deno.env.get('SUPABASE_URL')!
const CHAVE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CABECALHOS = {
  apikey: CHAVE,
  Authorization: `Bearer ${CHAVE}`,
  'Content-Type': 'application/json',
}

/**
 * Chama uma função SQL. Devolve array (funções TABLE) ou escalar.
 *
 * Função `returns void` vira 204 sem corpo — `.json()` nisso estoura
 * `SyntaxError: Unexpected end of JSON input`, sempre, mesmo a chamada tendo
 * dado certo. Foi assim que `whatsapp_meta_recebida` (void) derrubava toda
 * mensagem do Meta antes de chegar perto da IA.
 */
export async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, {
    method: 'POST',
    headers: CABECALHOS,
    body: JSON.stringify(args),
  })
  if (!r.ok) throw new Error(`rpc ${nome}: ${r.status} ${await r.text()}`)
  const texto = await r.text()
  return (texto ? JSON.parse(texto) : undefined) as T
}

/** Leitura direta. O caminho já vem com os filtros do PostgREST. */
export async function selecionar<T>(caminho: string): Promise<T[]> {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, { headers: CABECALHOS })
  if (!r.ok) throw new Error(`select ${caminho}: ${r.status} ${await r.text()}`)
  return await r.json() as T[]
}

/**
 * Insere e devolve a linha criada.
 *
 * `ignorarConflito` usa `resolution=ignore-duplicates`: é como a mensagem
 * repetida não vira linha nova quando o WhatsApp reenvia o mesmo webhook —
 * coisa que ele faz. Nesse caso a resposta vem vazia, e quem chamou trata.
 *
 * **`onConflito` é obrigatório para isso funcionar contra uma constraint que
 * não seja a chave primária.** Sem o parâmetro `on_conflict` na URL, o
 * PostgREST mira o `ON CONFLICT` na chave primária — que é sempre um UUID
 * novo e nunca colide — e a constraint de verdade (ex.: `id_externo`
 * repetido) estoura como erro normal em vez de virar resposta vazia.
 */
export async function inserir<T>(
  tabela: string,
  linha: Record<string, unknown>,
  ignorarConflito = false,
  onConflito?: string,
): Promise<T[]> {
  const prefer = ignorarConflito
    ? 'return=representation,resolution=ignore-duplicates'
    : 'return=representation'
  const query = ignorarConflito && onConflito ? `?on_conflict=${onConflito}` : ''

  const r = await fetch(`${URL_BASE}/rest/v1/${tabela}${query}`, {
    method: 'POST',
    headers: { ...CABECALHOS, Prefer: prefer },
    body: JSON.stringify(linha),
  })
  if (!r.ok) throw new Error(`insert ${tabela}: ${r.status} ${await r.text()}`)
  return await r.json() as T[]
}

/** Atualiza. `filtro` é a query do PostgREST, ex.: `id=eq.${id}`. */
export async function atualizar(
  tabela: string,
  filtro: string,
  campos: Record<string, unknown>,
): Promise<void> {
  const r = await fetch(`${URL_BASE}/rest/v1/${tabela}?${filtro}`, {
    method: 'PATCH',
    headers: { ...CABECALHOS, Prefer: 'return=minimal' },
    body: JSON.stringify(campos),
  })
  if (!r.ok) throw new Error(`update ${tabela}: ${r.status} ${await r.text()}`)
}

/** Sobe um arquivo para o Storage e devolve o caminho guardado. */
export async function subirMidia(
  caminho: string,
  bytes: Uint8Array,
  tipoMime: string,
): Promise<string> {
  const r = await fetch(`${URL_BASE}/storage/v1/object/midias-whatsapp/${caminho}`, {
    method: 'POST',
    headers: {
      apikey: CHAVE,
      Authorization: `Bearer ${CHAVE}`,
      'Content-Type': tipoMime,
    },
    body: new Uint8Array(bytes),
  })
  if (!r.ok) throw new Error(`storage: ${r.status} ${await r.text()}`)
  return caminho
}

/** Apaga linhas. `filtro` é a query do PostgREST, ex.: `id=eq.${id}`. */
export async function apagar(tabela: string, filtro: string): Promise<void> {
  const r = await fetch(`${URL_BASE}/rest/v1/${tabela}?${filtro}`, {
    method: 'DELETE',
    headers: { ...CABECALHOS, Prefer: 'return=minimal' },
  })
  if (!r.ok) throw new Error(`delete ${tabela}: ${r.status} ${await r.text()}`)
}

/**
 * Os arquivos que uma pessoa mandou, pelo prefixo da pasta dela.
 *
 * A mídia é gravada em `{lead_id}/{uuid}.{ext}`, então a pasta é o próprio id
 * do lead — é o que torna possível apagar tudo de alguém sem varrer o bucket.
 */
export async function listarMidias(prefixo: string): Promise<string[]> {
  const r = await fetch(`${URL_BASE}/storage/v1/object/list/midias-whatsapp`, {
    method: 'POST',
    headers: CABECALHOS,
    body: JSON.stringify({ prefix: prefixo, limit: 1000, offset: 0 }),
  })
  if (!r.ok) throw new Error(`storage list: ${r.status} ${await r.text()}`)
  const itens = await r.json() as { name?: string }[]
  return (itens ?? []).filter((i) => i.name).map((i) => `${prefixo}/${i.name}`)
}

/**
 * Apaga arquivos do bucket, de verdade.
 *
 * ⚠️ TEM QUE SER PELA STORAGE API. O Postgres **recusa** `delete from
 * storage.objects`, com uma mensagem que explica por quê: apagar só o registro
 * deixaria o arquivo órfão no backend, invisível e impossível de achar depois.
 *
 *   ERROR: Direct deletion from storage tables is not allowed.
 *   HINT:  This prevents accidental data loss from orphaned objects.
 *
 * Por isso a exclusão de uma pessoa mora aqui, na função, e não no navegador:
 * é o único lugar com a `service_role key` para falar com esta API.
 */
export async function apagarMidias(caminhos: string[]): Promise<number> {
  if (!caminhos.length) return 0
  const r = await fetch(`${URL_BASE}/storage/v1/object/midias-whatsapp`, {
    method: 'DELETE',
    headers: CABECALHOS,
    body: JSON.stringify({ prefixes: caminhos }),
  })
  if (!r.ok) throw new Error(`storage delete: ${r.status} ${await r.text()}`)
  return caminhos.length
}

/**
 * URL assinada de um arquivo do bucket de mídias, válida por `segundos`. É o que se entrega à uazapi para ela buscar
 * o anexo: o bucket é privado, então o endereço só funciona durante este prazo.
 */
export async function assinarMidia(caminho: string, segundos = 600): Promise<string> {
  const r = await fetch(`${URL_BASE}/storage/v1/object/sign/midias-whatsapp/${caminho}`, {
    method: 'POST', headers: CABECALHOS, body: JSON.stringify({ expiresIn: segundos }),
  })
  if (!r.ok) throw new Error(`storage sign: ${r.status} ${await r.text()}`)
  const { signedURL } = await r.json() as { signedURL?: string }
  if (!signedURL) throw new Error('storage sign: sem URL')
  return `${URL_BASE}/storage/v1${signedURL.startsWith('/') ? '' : '/'}${signedURL}`
}

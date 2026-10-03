export type LeadStatus =
  | 'novo_lead'
  | 'qualificacao'
  | 'diagnostico'
  | 'diagnostico_realizado'
  | 'proposta'
  | 'negociacao'
  | 'ganho'
  | 'perdido'

/**
 * O estado de uma consulta.
 *
 * `realizada` é a única porta automática para Clientes: o trigger
 * `consultas_sincroniza_lead` promove o lead quando a consulta vira isso.
 * `faltou` (migração 0015) não é `cancelada` — quem avisa e quem some pedem
 * telefonemas diferentes, e a empresa precisa medir a taxa de falta.
 *
 * Precisa bater com o CHECK de `consultas.status`. Nada sincroniza sozinho.
 */
export type ReuniaoStatus = 'agendada' | 'realizada' | 'cancelada' | 'faltou'

/** Quem criou a consulta. `agente_ia` chega pela API; `equipe`, pela tela. */
export type ReuniaoOrigem = 'equipe' | 'agente_ia'

/** Dois papéis, e só. Ver `PLANO_USUARIOS_E_PAPEIS.md`. */
export type PapelUsuario = 'gestor' | 'consultor'

export interface Usuario {
  id: string
  nome: string
  avatar_url: string | null
  created_at: string
  papel: PapelUsuario
  ativo: boolean
  /** Ponte opcional com a Equipe da agenda: profissional existe sem login. */
  profissional_id: string | null
  convidado_em: string | null
  ultimo_acesso_em: string | null
}

/**
 * A linha da tela de Usuários.
 *
 * Difere de `Usuario` porque e-mail e estado do convite moram em `auth.users`,
 * que só a `service_role` lê — vêm pela rota `/equipe/usuarios`, nunca por um
 * `select` do navegador.
 */
export interface MembroEquipe {
  id: string
  nome: string
  email: string | null
  papel: PapelUsuario
  ativo: boolean
  avatar_url: string | null
  profissional_id: string | null
  convidado_em: string | null
  /** Ainda não confirmou o e-mail pelo link do convite. */
  convite_pendente: boolean
  ultimo_acesso_em: string | null
  criado_em: string
}

export interface ConfiguracoesNegocio {
  id: string
  nome_negocio: string | null
  logo_url: string | null
  /** IANA (ex.: 'America/Sao_Paulo'). Base do cálculo de disponibilidade. */
  fuso_horario: string
  /** Rua, número e complemento num campo só: 'Rua Samuel Scott, 212 A - bloco 3'. */
  endereco: string | null
  bairro: string | null
  cidade: string | null
  /** UF de duas letras. O banco recusa qualquer coisa fora das 27. */
  estado: string | null
  /** Só dígitos: '88040600'. A pontuação existe apenas na tela. */
  cep: string | null
  google_maps_url: string | null
  instagram_url: string | null
  site_url: string | null
  created_at: string
  updated_at: string
}

export interface HorarioComercial {
  id: string
  dia_semana: number
  hora_inicio: string
  hora_fim: string
  ativo: boolean
}

export interface ServicoCatalogo {
  id: string
  nome: string
  /** A frase curta do catálogo. Módulos de assistente podem levá-la no prompt; mantenha-a curta (~120 caracteres). */
  descricao: string
  /** A explicação completa, para quando alguém pergunta daquele serviço. Vazia, vale a `descricao`. */
  descricao_longa: string | null
  ativo: boolean
  /**
   * Marcado: o serviço não é agendado direto — agenda-se a reunião prévia e o
   * nome do serviço fica em `Consulta.interesse`. Desmarcado: agenda direto.
   * Quem confere é a função SQL `agenda_marcar`; a equipe passa por fora.
   */
  exige_reuniao_previa: boolean
  /**
   * O piso do valor, com **três** estados: `null` (não se fala preço),
   * `0` (gratuito) e `> 0` ("a partir de R$ X"). Zero não é vazio.
   * Ignorado quando `exige_reuniao_previa`.
   */
  preco_a_partir_de: number | null
  /** Quanto tempo o bloco ocupa na agenda. */
  duracao_minutos: number
  /** A porta de entrada. **Exatamente um** serviço tem isto (índice único). */
  e_reuniao_previa: boolean
  arquivado: boolean
  created_at: string
}

/** Uma linha da view `contatos` (calculada sobre `contatos_dados`). */
export interface Contato {
  id: string
  nome: string | null
  whatsapp: string | null
  empresa: string | null
  email: string | null
  /** O que a pessoa procura. Cada item existe em `catalogo_servicos.nome` — o banco normaliza a grafia. */
  interesses: string[]
  /** CALCULADA na view: os itens de `interesses` juntados por vírgula. Nunca grave aqui. */
  interesses_texto: string | null
  resumo_conversa: string | null
  anotacoes: string | null
  status: LeadStatus
  inicio_atendimento: string | null
  ultima_mensagem: string | null
  minutos_ultima_mensagem: number | null
  /** Última reunião REALIZADA. Calculada na leitura — nunca grave nela. */
  ultima_reuniao: string | null
  /** Próxima reunião agendada no futuro. Calculada na leitura — nunca grave nela. */
  proxima_reuniao: string | null
  /** Mantido pelo banco a partir das oportunidades ganhas. Somente leitura. */
  cliente_desde: string | null
  created_at: string
}

export interface Consulta {
  id: string
  contato_id: string
  profissional_id: string | null
  assunto: string
  data_reuniao: string
  duracao_minutos: number
  /**
   * Fim da reunião, mantido pelo trigger `calcular_fim_reuniao`.
   * **Somente leitura** — grave `data_reuniao` e `duracao_minutos`.
   * Existe como coluna porque a restrição anti-conflito precisa de uma
   * expressão imutável, e `timestamptz + interval` não é.
   */
  data_fim: string
  status: ReuniaoStatus
  origem: ReuniaoOrigem
  chave_externa: string | null
  observacoes: string | null
  /**
   * O que o contato procura, quando a reunião é a prévia ("diagnóstico") —
   * o serviço de interesse, congelado no ato de marcar.
   *
   * Diferente de `interesses_texto`, que é da **pessoa** e guarda um
   * valor só: este é congelado no ato de marcar, então a consulta de março não
   * passa a mentir quando a pessoa volta em agosto por outra coisa.
   */
  interesse: string | null
  cancelado_em: string | null
  motivo_cancelamento: string | null
  created_at: string
  updated_at: string
}

/**
 * Profissional da agenda. NÃO é usuário do sistema — não faz login, é só um
 * recurso de agenda. A agenda dele são as consultas com este `id`; não existe
 * tabela de agenda.
 */
export interface Profissional {
  id: string
  nome: string
  sobrenome: string
  /** Hex de 6 dígitos. Identifica o profissional em toda a agenda. */
  cor: string
  ativo: boolean
  created_at: string
  updated_at: string
}

/** Jornada do profissional. Uma linha por dia — 0 = domingo … 6 = sábado. */
export interface ProfissionalHorario {
  id: string
  profissional_id: string
  dia_semana: number
  hora_inicio: string
  hora_fim: string
  ativo: boolean
}

/** Férias, feriado, almoço. `profissional_id` nulo = empresa inteira. */
export interface ProfissionalBloqueio {
  id: string
  profissional_id: string | null
  inicio: string
  fim: string
  motivo: string
  created_at: string
}

/**
 * Chave de acesso da API do Agente de IA.
 *
 * O valor em claro **não existe aqui, nem em lugar nenhum** — o banco guarda só
 * o `hash` (SHA-256). Por isso o token só pode ser exibido no instante da
 * criação: depois disso, nem o sistema consegue reconstruí-lo.
 *
 * Revogar é `ativo = false`, não `DELETE`: o histórico de quem teve acesso e
 * quando não pode sumir junto.
 */
export interface ApiToken {
  id: string
  nome: string
  /** Primeiros caracteres, visíveis na lista, para saber qual token é qual. */
  prefixo: string
  hash: string
  ativo: boolean
  criado_por: string | null
  /** Carimbado pela API no máximo a cada 5 minutos por token. */
  ultimo_acesso: string | null
  revogado_em: string | null
  created_at: string
}

/**
 * Consulta com os dados que a agenda precisa mostrar no bloco: de quem é a
 * consulta e qual o nome do cliente. Vem do join da Agenda.tsx.
 */
export interface ReuniaoAgenda extends Consulta {
  lead: { id: string; nome: string | null; whatsapp: string | null } | null
}

/* ===========================================================================
 * Agente de IA — conversas do WhatsApp (migração 0010)
 * Documentação: agente-ia/README.md
 * =========================================================================== */

/** Quem escreveu. Define a cor do balão na tela Conversas. */
export type AutorMensagem = 'cliente' | 'agente' | 'atendente'

export type TipoMensagem = 'texto' | 'audio' | 'imagem' | 'video' | 'documento'

export interface MensagemWhatsapp {
  id: string
  contato_id: string
  autor: AutorMensagem
  tipo: TipoMensagem
  /** O texto. Em áudio, guarda a **transcrição** — é o que o modelo lê. */
  conteudo: string | null
  /** Caminho no bucket privado `midias-whatsapp`. Abrir com signed URL. */
  midia_url: string | null
  /** Preenchido quando a retenção de mídia apagou o arquivo (`midia_url` fica nulo). */
  midia_removida_em?: string | null
  /** Id externo da mensagem no provedor. Único — impede duplicata em reenvio. */
  id_externo: string | null
  provedor?: 'meta' | 'uazapi' | 'legado'
  estado_envio?: 'pendente' | 'enviado' | 'entregue' | 'lido' | 'falhou' | 'incerto' | null
  erro_envio?: string | null
  /** Origem operacional. Campanhas continuam assinadas por um atendente real. */
  origem_envio?: 'agente' | 'atendimento' | 'campanha' | null
  campanha_id?: string | null
  /** Snapshot legível devolvido pelo banco para identificar a origem no histórico. */
  campanha_nome?: string | null
  /** Preenchido só quando `autor === 'atendente'`. */
  enviada_por: string | null
  /** Leitura da equipe inteira, não por usuário. */
  lida: boolean
  criada_em: string
}

/**
 * Modelos que a página "Secretária de IA" oferece.
 *
 * ⚠️ **Acrescentar um exige TRÊS lugares:** este tipo, a lista `MODELOS` de
 * `src/lib/modelosIA.ts` (o nome, a nota e o fornecedor) e o `conversar()` de
 * `supabase/functions/_shared/llm.ts`. Nada sincroniza isso sozinho.
 *
 * A coluna `configuracoes_agente.modelo` é `text` **sem `CHECK`**, de
 * propósito: acrescentar modelo não deve exigir migração, pela mesma razão de
 * `cores.ts` e da lista de fusos. Quem recusa o valor errado é a API do
 * fornecedor, e o motivo dela é melhor que o nosso.
 *
 * Estes foram testados contra a conta da empresa antes de entrarem — modelo
 * que existe na documentação e não responde nesta conta é uma opção que
 * promete e falha.
 */
export type ModeloAgente =
  | 'gpt-4.1-mini'
  | 'gpt-4.1'
  | 'gpt-5'
  | 'gpt-5.1'
  | 'gpt-5.4-mini'
  | 'gpt-5.5'
  | 'claude-sonnet-5'
  | 'claude-opus-5'

export interface ConfiguracoesAgente {
  id: string
  /** Desligado por padrão. Ligar é ato consciente, feito na tela. */
  ativo: boolean
  modelo: ModeloAgente
  /**
   * `null` = está rodando o prompt oficial de `agente-ia/prompt.md`.
   * Preenchido = alguém editou pela tela, e **este** é o que está no ar.
   */
  prompt: string | null
  /**
   * Ligado, o agente só responde aos números de `numeros_teste`. As demais
   * mensagens são gravadas, aparecem na tela, e ficam sem resposta.
   */
  modo_teste: boolean
  /** Formato canônico: só dígitos com DDI (`5511987654321`). */
  numeros_teste: string[]
  /**
   * Qual ponte com o WhatsApp está ativa (migração 0017). **UMA de cada vez.**
   *
   * ⚠️ Os valores vivem em dois lugares: o `CHECK` no banco e este tipo.
   * Acrescentou provedor? Mude os dois no mesmo commit.
   *
   * As credenciais NÃO vêm daqui — moram nas secrets do Supabase, fora do
   * alcance do navegador. Esta coluna diz quem está ativo, nunca como se
   * autentica.
   */
  provedor_whatsapp: 'meta' | 'uazapi'
  /**
   * Como o Agente de IA se chama (migração `0019`).
   *
   * **Uma fonte, dois leitores**: as telas (pelo `useAgente()` de
   * `src/lib/agente.ts`) e o prompt (pelo marcador `{{NOME_AGENTE}}`). Antes
   * eram dois sistemas que não se falavam, e renomear exigia editar os dois.
   *
   * ⚠️ Isto é o NOME, não o cargo. "Secretária IA" e "Secretária de IA"
   * continuam constantes no código — trocar "Assistente" por "Sofia" não renomeia
   * a página. O banco garante não-vazio (`not null` + `CHECK` de 1 a 40).
   */
  nome_agente: string
  atualizado_por: string | null
  created_at: string
  updated_at: string
}

/**
 * Uma linha da view `conversas_lista` (migração 0013) — o que a coluna da
 * esquerda da tela Conversas mostra de cada pessoa.
 *
 * **Somente leitura:** é calculada na leitura, a partir de `contatos_dados`
 * e `mensagens_whatsapp`. Para mudar algo aqui, escreva na tabela de origem.
 */
export interface ConversaResumo {
  contato_id: string
  nome: string | null
  whatsapp: string | null
  status: LeadStatus
  /** Um humano da equipe assumiu a conversa (`assumido_por` preenchido). */
  assumida: boolean
  assumido_por: string | null
  assumido_em: string | null
  /** Nome de quem assumiu, já resolvido pelo join com `usuarios`. */
  assumido_por_nome: string | null
  ultimo_conteudo: string | null
  ultimo_tipo: TipoMensagem
  ultimo_autor: AutorMensagem
  ultima_em: string
  /** Só conta mensagem do cliente. É a bolinha azul da lista. */
  nao_lidas: number
  /** A próxima reunião agendada no futuro. Nula = sem reunião marcada. Não use `status` para isso. */
  proxima_reuniao: string | null
  /** Até quando a conversa está adiada (migração 0016). Nulo ou passado = na fila. */
  adiada_ate?: string | null
  /** Só existem com o módulo assistente (migração 0009). */
  ia_ligada?: boolean
  /** Quando o assistente passou a conversa para a equipe; limpo ao concluir. */
  ia_encaminhada_em?: string | null
  ia_resumo?: string | null
}

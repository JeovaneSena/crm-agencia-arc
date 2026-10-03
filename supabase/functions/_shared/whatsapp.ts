// Transport contract for Meta Cloud API and uazapi. Meta sends use the durable service.
// O estado da conexão

export type Estado =
  | 'conectado'
  | 'conectando'
  | 'desconectado'
  | 'indisponivel'
  | 'nao_configurado'

export interface Conexao {
  estado: Estado
  numero: string | null
  perfil: string | null
  foto: string | null
}

// O que chega

export type Midia =
  | { via: 'url'; url: string }
  | { via: 'meta'; id: string }
  | { via: 'uazapi'; id: string }

export interface MensagemRecebida {
  whatsapp: string
  idExterno: string | null
  tipo: string
  texto: string | null
  midia: Midia | null
}

export type Recebimento =
  | { tipo: 'mensagem'; mensagem: MensagemRecebida }
  | { tipo: 'ignorar'; motivo: string }

// A porta

export interface Ponte {
  readonly nome: string

  configurada(): boolean

  lerWebhook(corpo: Record<string, unknown>): Recebimento

  digitando(numero: string, ms: number): Promise<void>

  enviarTexto(numero: string, texto: string): Promise<string | null>
  /** Foto, vídeo, áudio ou documento por URL (assinada e curta). Lança se não saiu. */
  enviarMidia(numero: string, tipo: 'image' | 'video' | 'audio' | 'document', url: string, legenda: string | null, nomeArquivo: string | null): Promise<string | null>

  baixarMidia(midia: Midia): Promise<{ base64: string; tipoMime: string } | null>

  fotoDoPerfil(numero: string): Promise<string | null>

  estadoDaConexao(): Promise<Conexao>

  iniciarConexao(numero?: string): Promise<{ codigo: string | null; qr: string | null } | null>

  desconectar(): Promise<boolean>

  webhook(): Promise<WebhookLido | null>

  identificacao(): {
    servidor: string | null
    instancia: string | null
    chaveFinal: string | null
  }
}

export function soDigitos(jid: string): string {
  return (jid ?? '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

export function foraDoAr(estado: Estado = 'indisponivel'): Conexao {
  return { estado, numero: null, perfil: null, foto: null }
}

// O webhook está apontado para cá?
//
// ── A TERCEIRA CONDIÇÃO ────────────────────────────────────────────────────
//
// Atender depende de três coisas: o agente ligado, o WhatsApp conectado e o
// webhook apontado para esta função. O card da Secretária aprendeu a segunda
// depois de 01/09 — antes disso afirmou "está atendendo" por horas com a ponte
// fora do ar.
//
// A terceira era o mesmo buraco. Com a sessão de pé e o webhook desligado, o
// card diz **"Conectado"**, em verde, e o paciente recebe silêncio: nada chega
// no banco, nada aparece em Conversas, a Gabriela nunca fica sabendo. Painel que
// afirma o que não sabe é pior que painel vazio.

export interface WebhookLido {
  url: string | null
  ativo: boolean
}

export type VeredictoWebhook = 'apontado' | 'outro' | 'ausente' | 'desconhecido'

export function avaliarWebhook(
  lido: WebhookLido | null,
  nossaUrl: string,
): VeredictoWebhook {
  if (!lido) return 'desconhecido'
  if (!lido.ativo || !lido.url) return 'ausente'
  try {
    const dele = new URL(lido.url)
    const nosso = new URL(nossaUrl)
    const caminho = (u: URL) => u.pathname.replace(/\/+$/, '')
    return dele.origin === nosso.origin && caminho(dele) === caminho(nosso)
      ? 'apontado'
      : 'outro'
  } catch {
    // URL que nem parseia não está apontada para nós.
    return 'outro'
  }
}

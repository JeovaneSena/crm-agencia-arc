/**
 * Anexos na conversa: só o que ajuda a pessoa ANTES de enviar (tamanho, tipo, ícone). Quem decide de verdade é
 * a função `whatsapp/enviar-midia`, que confere os primeiros bytes do arquivo; aqui a recusa é só mais cedo.
 */
export const LIMITE_IMAGEM = 5 * 1024 * 1024
export const LIMITE_ANEXO = 16 * 1024 * 1024
export const ACEITOS = '.jpg,.jpeg,.png,.webp,.mp4,.mp3,.ogg,.oga,.opus,.m4a,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv'

const EXTENSOES = new Set(ACEITOS.split(',').map((e) => e.slice(1)))
const IMAGENS = new Set(['jpg', 'jpeg', 'png', 'webp'])

export const tamanhoLegivel = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

/** `null` = pode tentar enviar; senão, a frase que explica por que não. */
export function problemaDoAnexo(nome: string, tamanho: number): string | null {
  const ext = (nome.split('.').pop() ?? '').toLowerCase()
  if (!EXTENSOES.has(ext)) return 'Esse tipo de arquivo não é aceito. Envie foto (JPG, PNG, WebP), vídeo MP4, áudio (MP3, OGG, M4A), PDF, documento do Office, TXT ou CSV.'
  if (tamanho === 0) return 'O arquivo está vazio.'
  if (IMAGENS.has(ext) && tamanho > LIMITE_IMAGEM) return 'Imagem acima de 5 MB: o WhatsApp não aceita.'
  if (tamanho > LIMITE_ANEXO) return 'Arquivo acima de 16 MB: o WhatsApp não aceita.'
  return null
}

/**
 * Anexos que a equipe manda pelo WhatsApp (foto, vídeo, áudio, documento): o que aceitar e o que recusar.
 *
 * O navegador diz o tipo do arquivo, mas quem decide é o servidor, olhando os primeiros bytes (a "assinatura"
 * do formato). Um executável renomeado para .pdf tem tipo declarado `application/pdf` e não passa daqui.
 * Só lógica: sem rede, para testar. Os limites seguem os do WhatsApp (imagem até 5 MB; o resto até 16 MB).
 *
 * ⚠️ Gravar áudio no navegador (mensagem de voz) NÃO está aqui: o navegador grava em webm/opus, que o WhatsApp
 * não aceita como voz sem conversão. Anexar um arquivo de áudio pronto (mp3, ogg, m4a) funciona.
 */
export type TipoAnexo = 'imagem' | 'video' | 'audio' | 'documento'
export interface AnexoAceito { tipo: TipoAnexo; uazapi: 'image' | 'video' | 'audio' | 'document'; mime: string; extensao: string; nomeSeguro: string }

export const LIMITE_IMAGEM = 5 * 1024 * 1024
export const LIMITE_ANEXO = 16 * 1024 * 1024

const ZIP = [0x50, 0x4b, 0x03, 0x04]
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const comeca = (b: Uint8Array, assinatura: number[], desde = 0) => assinatura.every((x, i) => b[desde + i] === x)
const ascii = (b: Uint8Array, desde: number, texto: string) => [...texto].every((c, i) => b[desde + i] === c.charCodeAt(0))

interface Formato { tipo: TipoAnexo; uazapi: AnexoAceito['uazapi']; extensoes: string[]; confere: (b: Uint8Array) => boolean; limite: number }
const documento = (extensoes: string[], confere: Formato['confere']): Formato => ({ tipo: 'documento', uazapi: 'document', extensoes, confere, limite: LIMITE_ANEXO })

const FORMATOS: Record<string, Formato> = {
  'image/jpeg': { tipo: 'imagem', uazapi: 'image', extensoes: ['jpg', 'jpeg'], confere: (b) => comeca(b, [0xff, 0xd8, 0xff]), limite: LIMITE_IMAGEM },
  'image/png': { tipo: 'imagem', uazapi: 'image', extensoes: ['png'], confere: (b) => comeca(b, [0x89, 0x50, 0x4e, 0x47]), limite: LIMITE_IMAGEM },
  'image/webp': { tipo: 'imagem', uazapi: 'image', extensoes: ['webp'], confere: (b) => ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP'), limite: LIMITE_IMAGEM },
  'video/mp4': { tipo: 'video', uazapi: 'video', extensoes: ['mp4'], confere: (b) => ascii(b, 4, 'ftyp'), limite: LIMITE_ANEXO },
  'audio/mpeg': { tipo: 'audio', uazapi: 'audio', extensoes: ['mp3'], confere: (b) => ascii(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0), limite: LIMITE_ANEXO },
  'audio/ogg': { tipo: 'audio', uazapi: 'audio', extensoes: ['ogg', 'oga', 'opus'], confere: (b) => ascii(b, 0, 'OggS'), limite: LIMITE_ANEXO },
  'audio/mp4': { tipo: 'audio', uazapi: 'audio', extensoes: ['m4a'], confere: (b) => ascii(b, 4, 'ftyp'), limite: LIMITE_ANEXO },
  'application/pdf': documento(['pdf'], (b) => ascii(b, 0, '%PDF')),
  'application/msword': documento(['doc'], (b) => comeca(b, OLE)),
  'application/vnd.ms-excel': documento(['xls'], (b) => comeca(b, OLE)),
  'application/vnd.ms-powerpoint': documento(['ppt'], (b) => comeca(b, OLE)),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': documento(['docx'], (b) => comeca(b, ZIP)),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': documento(['xlsx'], (b) => comeca(b, ZIP)),
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': documento(['pptx'], (b) => comeca(b, ZIP)),
  'text/plain': documento(['txt'], (b) => !b.subarray(0, 1000).includes(0)),
  'text/csv': documento(['csv'], (b) => !b.subarray(0, 1000).includes(0)),
}

/** Só o nome do arquivo, sem pasta nem caracteres de controle, em até 100 caracteres (vai à legenda do documento). */
export function nomeSeguro(nome: string): string {
  const base = nome.split(/[\\/]/).pop() ?? ''
  const limpo = [...base].filter((c) => { const k = c.charCodeAt(0); return k > 31 && k !== 127 }).join('').trim()
  return limpo.slice(-100) || 'arquivo'
}

export function classificarAnexo(nome: string, mime: string, bytes: Uint8Array): { ok: true; anexo: AnexoAceito } | { ok: false; erro: string } {
  const tipoDeclarado = mime.split(';')[0].trim().toLowerCase()
  const f = FORMATOS[tipoDeclarado]
  if (!f) return { ok: false, erro: 'Esse tipo de arquivo não é aceito. Envie foto (JPG, PNG, WebP), vídeo MP4, áudio (MP3, OGG, M4A), PDF, documento do Office, TXT ou CSV.' }
  if (bytes.length === 0) return { ok: false, erro: 'O arquivo está vazio.' }
  if (bytes.length > f.limite) return { ok: false, erro: `O arquivo passa do limite do WhatsApp para ${f.tipo === 'imagem' ? 'imagens (5 MB)' : 'este tipo (16 MB)'}.` }
  const nomeFinal = nomeSeguro(nome)
  const ext = (nomeFinal.split('.').pop() ?? '').toLowerCase()
  if (!f.extensoes.includes(ext)) return { ok: false, erro: `O nome do arquivo deveria terminar em .${f.extensoes[0]}.` }
  if (!f.confere(bytes)) return { ok: false, erro: 'O conteúdo do arquivo não bate com o tipo informado.' }
  return { ok: true, anexo: { tipo: f.tipo, uazapi: f.uazapi, mime: tipoDeclarado, extensao: f.extensoes[0], nomeSeguro: nomeFinal } }
}

// Anexos: o que a função aceita ou recusa, olhando os bytes e não só o tipo declarado.
import { classificarAnexo, LIMITE_ANEXO, LIMITE_IMAGEM, nomeSeguro } from './anexos.ts'

function assert(v: unknown, m = 'Assertion failed'): asserts v { if (!v) throw new Error(m) }
const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
const texto = (t: string) => new TextEncoder().encode(t)
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0), PNG = bytes(0x89, 0x50, 0x4e, 0x47), PDF = texto('%PDF-1.7 ...')
const erro = (n: string, m: string, b: Uint8Array) => { const r = classificarAnexo(n, m, b); return r.ok ? null : r.erro }

Deno.test('anexo: aceita cada formato com a assinatura certa e devolve o tipo da uazapi', () => {
  const casos: [string, string, Uint8Array, string, string][] = [
    ['foto.jpg', 'image/jpeg', JPG, 'imagem', 'image'], ['foto.JPEG', 'image/jpeg', JPG, 'imagem', 'image'], ['a.png', 'image/png', PNG, 'imagem', 'image'],
    ['a.webp', 'image/webp', texto('RIFF....WEBPVP8 '), 'imagem', 'image'], ['v.mp4', 'video/mp4', texto('....ftypisom'), 'video', 'video'],
    ['m.mp3', 'audio/mpeg', texto('ID3....'), 'audio', 'audio'], ['m.mp3', 'audio/mpeg', bytes(0xff, 0xfb, 0x90), 'audio', 'audio'],
    ['o.ogg', 'audio/ogg', texto('OggS....'), 'audio', 'audio'], ['m.m4a', 'audio/mp4', texto('....ftypM4A '), 'audio', 'audio'],
    ['p.pdf', 'application/pdf', PDF, 'documento', 'document'], ['t.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes(0x50, 0x4b, 0x03, 0x04), 'documento', 'document'],
    ['t.doc', 'application/msword', bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), 'documento', 'document'],
    ['n.txt', 'text/plain; charset=utf-8', texto('olá'), 'documento', 'document'], ['n.csv', 'text/csv', texto('a,b\n1,2'), 'documento', 'document'],
  ]
  for (const [nome, mime, b, tipo, uazapi] of casos) {
    const r = classificarAnexo(nome, mime, b)
    assert(r.ok && r.anexo.tipo === tipo && r.anexo.uazapi === uazapi, `${nome}: ${JSON.stringify(r)}`)
  }
})

Deno.test('anexo: tipo declarado que o conteúdo desmente é recusado (executável renomeado, imagem com texto)', () => {
  assert(erro('fatura.pdf', 'application/pdf', bytes(0x4d, 0x5a, 0x90))?.includes('não bate'), 'exe como pdf')
  assert(erro('foto.jpg', 'image/jpeg', PNG)?.includes('não bate'), 'png como jpg')
  assert(erro('foto.png', 'image/png', texto('<script>alert(1)</script>'))?.includes('não bate'))
  assert(erro('t.txt', 'text/plain', bytes(0x41, 0x00, 0x42))?.includes('não bate'), 'binário como texto')
  assert(erro('t.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', PDF)?.includes('não bate'))
})

Deno.test('anexo: extensão tem que combinar com o tipo, e tipo desconhecido é recusado', () => {
  assert(erro('foto.exe', 'image/jpeg', JPG)?.includes('.jpg'))
  assert(erro('semextensao', 'application/pdf', PDF)?.includes('.pdf'))
  for (const m of ['application/x-msdownload', 'text/html', 'image/svg+xml', 'application/javascript', 'application/zip', '']) assert(erro('a.bin', m, JPG)?.includes('não é aceito'), m)
})

Deno.test('anexo: vazio e acima do limite são recusados (imagem 5 MB, o resto 16 MB)', () => {
  assert(erro('a.pdf', 'application/pdf', new Uint8Array())?.includes('vazio'))
  const grandeImg = new Uint8Array(LIMITE_IMAGEM + 1); grandeImg.set([0xff, 0xd8, 0xff])
  assert(erro('a.jpg', 'image/jpeg', grandeImg)?.includes('5 MB'))
  const okImg = new Uint8Array(LIMITE_IMAGEM); okImg.set([0xff, 0xd8, 0xff]); assert(classificarAnexo('a.jpg', 'image/jpeg', okImg).ok)
  const grandePdf = new Uint8Array(LIMITE_ANEXO + 1); grandePdf.set(texto('%PDF'))
  assert(erro('a.pdf', 'application/pdf', grandePdf)?.includes('16 MB'))
})

Deno.test('anexo: nome seguro tira pasta e caracteres de controle e limita o tamanho', () => {
  assert(nomeSeguro('C:\\Users\\x\\fatura final.pdf') === 'fatura final.pdf')
  assert(nomeSeguro('../../etc/passwd') === 'passwd')
  assert(nomeSeguro('a\u0000b\nc.pdf') === 'abc.pdf')
  assert(nomeSeguro('   ') === 'arquivo' && nomeSeguro('') === 'arquivo')
  assert(nomeSeguro('x'.repeat(300) + '.pdf').length === 100 && nomeSeguro('x'.repeat(300) + '.pdf').endsWith('.pdf'), 'mantém o fim, onde está a extensão')
})

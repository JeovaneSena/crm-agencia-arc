// Varredura de conteúdo que nunca pode existir numa instalação: refs, domínios,
// credenciais e tokens da ARC ou de outros clientes. Usada pelo gerador (antes
// de entregar a pasta) e pelo preflight (a qualquer momento).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'

// Padrões genéricos (formato de credencial). Não identificam nenhum cliente.
export const PADROES = [
  ['token de gestão Supabase', /sbp_[A-Za-z0-9]{20,}/],
  ['chave JWT (anon/service_role)', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ['chave de modelo (Anthropic)', /sk-ant-[A-Za-z0-9_-]{10,}/],
]

// Identificadores de clientes (refs de projeto, domínios, servidores). Esta
// lista é copiada para toda instalação, por isso guarda só o SHA-256: quem a
// recebe consegue verificar, mas não aprende o identificador de outro cliente.
// Para incluir um novo: `node -e "console.log(require('crypto').createHash('sha256').update('<valor em minúsculas>').digest('hex'))"`.
const REF_TAMANHO = 20
const REFS = [
  ['ref do Supabase da ARC', 'cf1628f448cdfb265bec43f4ac9f4318005c6d3e1983aea310af6a18aeeeb976'],
  ['ref do Supabase da Bahiasol', '427c0a2b93d1bd8146ff393b46dc06c12ea022817cc32b1100fe4b359e0e87ca'],
]
const HOSTS = [
  ['domínio da ARC', '9ebb023fe4dbbe859e161f80b369c6e21acbbc434847e1a550fd84280b9ea28d'],
  ['servidor uazapi de cliente', 'c820299256fc6ec1c39aba29847d77d83a68de56b13f7c1ddec40645e4b3a8ef'],
]
const sha = (t) => createHash('sha256').update(t).digest('hex')

/** Motivos de identificadores de cliente achados em `conteudo` (sem repetir). */
export function identificadoresDeCliente(conteudo) {
  const texto = conteudo.toLowerCase()
  const motivos = new Set()
  for (const corrida of texto.match(/[a-z0-9]{20,}/g) ?? []) {
    for (let i = 0; i + REF_TAMANHO <= corrida.length; i++) {
      const h = sha(corrida.slice(i, i + REF_TAMANHO))
      for (const [motivo, hash] of REFS) if (h === hash) motivos.add(motivo)
    }
  }
  for (const host of texto.match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) ?? []) {
    const partes = host.split('.')
    for (let i = 0; i < partes.length - 1; i++) {
      const h = sha(partes.slice(i).join('.'))
      for (const [motivo, hash] of HOSTS) if (h === hash) motivos.add(motivo)
    }
  }
  return [...motivos]
}

const IGNORAR_DIRS = new Set(['node_modules', 'dist', '.git', 'legacy'])
const IGNORAR_ARQUIVOS = new Set(['package-lock.json'])
const TEXTO = /\.(m?[jt]sx?|json|sql|md|html|css|toml|svg|ya?ml|txt|example)$/

/** Devolve `[{ arquivo, motivo }]` para cada ocorrência proibida sob `raiz`. */
export function varrer(raiz) {
  const achados = []
  const andar = (dir) => {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome)
      const info = statSync(caminho)
      if (info.isDirectory()) {
        if (!IGNORAR_DIRS.has(nome)) andar(caminho)
        continue
      }
      if (IGNORAR_ARQUIVOS.has(nome) || !(TEXTO.test(nome) || nome === '.env.example')) continue
      const conteudo = readFileSync(caminho, 'utf8')
      const arquivo = relative(raiz, caminho)
      for (const [motivo, regex] of PADROES) {
        if (regex.test(conteudo)) achados.push({ arquivo, motivo })
      }
      for (const motivo of identificadoresDeCliente(conteudo)) achados.push({ arquivo, motivo })
    }
  }
  andar(raiz)
  return achados
}

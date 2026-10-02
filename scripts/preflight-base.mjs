import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { varrer } from './lib/proibidos.mjs'

const raiz = resolve(import.meta.dirname, '..')
const proibidos = [
  '.supabase-token.local',
  'agente-ia/.env.agente.local',
  'agente-ia/.env.agente.local.save',
  'deploy',
]
const encontrados = proibidos.filter(nome => existsSync(resolve(raiz, nome)))
const pacote = JSON.parse(readFileSync(resolve(raiz, 'package.json'), 'utf8'))
const comandosRemotos = Object.entries(pacote.scripts ?? {})
  .filter(([, comando]) => /agente-ia\/publicar|scripts\/database\.mjs|worker\.mjs|supabase\s+(db|functions|link|deploy)/.test(comando))
  .map(([nome]) => nome)

const conteudo = varrer(raiz)
const instalacao = existsSync(resolve(raiz, 'instalacao.json'))

if (encontrados.length || comandosRemotos.length || conteudo.length) {
  for (const c of conteudo) console.error(`Conteúdo proibido em ${c.arquivo}: ${c.motivo}`)
  if (encontrados.length) console.error('Arquivos ou destinos proibidos:', encontrados.join(', '))
  if (comandosRemotos.length) console.error('Comandos remotos ativos:', comandosRemotos.join(', '))
  process.exitCode = 1
} else {
  console.log(instalacao ? 'Isolamento da instalação verificado.' : 'Isolamento local verificado. A base ainda não está pronta para publicação.')
}

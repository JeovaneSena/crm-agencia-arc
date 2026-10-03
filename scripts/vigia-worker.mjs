// Agenda o vigia da função `whatsapp`: confere mensagem presa, conexão caída, assistente esquecido em
// modo de teste e arquivos vencidos pela retenção de mídia, e abre ou fecha avisos na Central. Rode a cada 5 minutos num agendador (cron).
// Nenhuma credencial é lida de arquivo: tudo por variável de ambiente.
//
//   SUPABASE_URL=https://<ref>.supabase.co VIGIA_SEGREDO=... node scripts/vigia-worker.mjs
const url = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
const segredo = process.env.VIGIA_SEGREDO ?? ''

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || segredo.length < 24) {
  console.error('Defina SUPABASE_URL (https://<ref>.supabase.co) e VIGIA_SEGREDO (24+ caracteres, o mesmo secret da função whatsapp).')
  process.exit(2)
}

try {
  const r = await fetch(`${url}/functions/v1/whatsapp/vigiar`, {
    method: 'POST', headers: { Authorization: `Bearer ${segredo}`, 'Content-Type': 'application/json' },
    body: '{}', signal: AbortSignal.timeout(120_000),
  })
  const corpo = await r.json().catch(() => null)
  if (!corpo || (r.status !== 200 && r.status !== 500)) throw Error(`http ${r.status}${corpo?.motivo ? ` (${corpo.motivo})` : ''}`)
  console.log(`Vigia: ${corpo.mensagensPresas} mensagem(ns) presa(s), conexão ${corpo.conexao}, assistente em teste: ${corpo.assistenteEmTeste ? 'sim' : 'não'}, ${corpo.midiasRemovidas} arquivo(s) vencido(s) removido(s), ${corpo.avisosApagados} aviso(s) antigo(s) apagado(s).`)
  if (corpo.erros?.length) throw Error(`verificação com erro: ${corpo.erros.join(', ')} (veja o log da função)`)
} catch (e) {
  console.error(`Falha no vigia: ${e.message}. Confira a publicação da função whatsapp e o segredo VIGIA_SEGREDO.`)
  process.exit(1)
}

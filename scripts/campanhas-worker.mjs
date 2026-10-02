// Trabalhador da fila de campanhas: chama a função `campanhas` para enviar um lote. Rode uma vez por minuto
// num agendador (cron). Nenhuma credencial é lida de arquivo: tudo por variável de ambiente.
//
//   SUPABASE_URL=https://<ref>.supabase.co CAMPANHAS_WORKER_SECRET=... [CAMPANHAS_LOTE=10] node scripts/campanhas-worker.mjs
//
// O ritmo real (por minuto e por dia) é do banco (`campanhas_controle`): rodar isto mais vezes não envia mais.
const url = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
const segredo = process.env.CAMPANHAS_WORKER_SECRET ?? ''
const configurado = Number(process.env.CAMPANHAS_LOTE ?? 10)
const limite = Number.isInteger(configurado) ? Math.max(1, Math.min(50, configurado)) : 10

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || segredo.length < 24) {
  console.error('Defina SUPABASE_URL (https://<ref>.supabase.co) e CAMPANHAS_WORKER_SECRET (24+ caracteres).')
  process.exit(2)
}

try {
  const r = await fetch(`${url}/functions/v1/campanhas/processar`, {
    method: 'POST', headers: { Authorization: `Bearer ${segredo}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ limite }), signal: AbortSignal.timeout(180_000),
  })
  const corpo = await r.json().catch(() => null)
  if (!r.ok || corpo?.ok !== true) throw Error(`http ${r.status}${corpo?.motivo ? ` (${corpo.motivo})` : ''}`)
  console.log(`Campanhas: ${corpo.processados} processado(s), ${corpo.aceitos} aceito(s), ${corpo.falhas} falha(s), ${corpo.incertos} incerto(s), ${corpo.repetidos} para repetir, ${corpo.pausadas} pausa(s) automática(s).`)
} catch (e) {
  console.error(`Falha na fila de campanhas: ${e.message}. Confira a publicação da função, as secrets da Meta e o segredo do trabalhador.`)
  process.exit(1)
}

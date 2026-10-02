// Exploração manual contra um projeto real (descartável): visita as rotas do núcleo
// e lista erros de console e respostas HTTP >= 400. Uso: node scripts/e2e-explorar.mjs
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
const cred = Object.fromEntries(readFileSync('.teste-usuario.local', 'utf8').trim().split('\n').map(l => l.split(/=(.*)/s).slice(0, 2)))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const problemas = []
let rota = 'login'
page.on('console', m => { if (m.type() === 'error') problemas.push(`[${rota}] console: ${m.text().slice(0, 200)}`) })
page.on('pageerror', e => problemas.push(`[${rota}] exceção: ${e.message.slice(0, 200)}`))
page.on('response', r => { if (r.status() >= 400 && !r.url().includes('favicon')) problemas.push(`[${rota}] HTTP ${r.status()} ${r.request().method()} ${r.url().replace(/https:\/\/[^/]+/, '').slice(0, 140)}`) })
await page.goto('http://localhost:5173/login')
await page.getByLabel(/e-?mail/i).fill(cred.email)
await page.locator('input[type=password]').first().fill(cred.senha)
await page.getByRole('button', { name: /entrar/i }).click()
await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => problemas.push('login não saiu de /login'))
console.log('depois do login:', page.url())
for (const r of ['/', '/crm', '/leads', '/clientes', '/agenda', '/equipe', '/servicos', '/usuarios', '/configuracoes']) {
  rota = r
  await page.goto('http://localhost:5173' + r)
  await page.waitForTimeout(1800)
  const titulo = (await page.locator('h1').first().textContent().catch(() => null))?.trim()
  console.log(r.padEnd(15), '→', page.url().replace('http://localhost:5173', '') || '/', '|', titulo)
  await page.screenshot({ path: `/tmp/claude-0/-root/9d35f11c-bb56-4330-b184-bab6fd796e6a/scratchpad/${r === '/' ? 'dashboard' : r.slice(1)}.png` })
}
console.log('\nProblemas:', problemas.length ? '\n' + [...new Set(problemas)].join('\n') : 'nenhum')
await browser.close()

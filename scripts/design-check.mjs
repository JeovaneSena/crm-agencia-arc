import { expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'

// Called by browser-check.mjs after the commercial flows, using its isolated APIs.
export async function verifyDesign({ page, context, base, leadId, setConnectionState, fixtures }) {
  const out = '/tmp/arc-design-validation'
  mkdirSync(out, { recursive: true })
  const issues = [], results = [], contrastIssues = []
  const routes = ['/', '/crm', '/leads', '/clientes', '/projetos', '/agenda', '/equipe', '/servicos', '/configuracoes', '/assistente-ia', '/token-api', `/leads/${leadId}`, `/conversas?lead=${leadId}`]
  const selectedWidths = process.argv.find(value => value.startsWith('--design-widths='))?.split('=')[1]
  const widths = selectedWidths ? selectedWidths.split(',').map(Number) : [360, 390, 768, 1024, 1440]
  async function screenshot(name) {
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(350)
    await page.screenshot({ path: `${out}/${name}.png` })
  }
  async function navigate(path) {
    // Exercise the same client-side routing as the sidebar, avoiding a complete
    // reload of the development bundle for every viewport/route combination.
    await page.evaluate(path => {
      history.pushState(null, '', path)
      window.dispatchEvent(new PopStateEvent('popstate'))
      document.querySelector('main')?.scrollTo(0, 0)
    }, path)
    await page.waitForTimeout(150)
    await page.locator('.app-main h1').waitFor({ state: 'attached' })
    await page.locator('.loading-state').waitFor({ state: 'hidden' })
  }
  async function noOverflow(label) {
    const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, main: document.querySelector('main')?.clientWidth, content: document.querySelector('main')?.scrollWidth }))
    if (widths.document > widths.viewport + 1 || widths.content > widths.main + 1) issues.push({ label, ...widths })
  }
  async function theme(value) {
    const html = page.locator('html')
    if (await html.getAttribute('data-theme') === value &&
      await html.getAttribute('data-preference') === value) return
    async function clicar(nome) {
      if (await page.getByRole('button', { name: 'Menu de navegação', exact: true }).isVisible()) {
        await page.getByRole('button', { name: 'Menu de navegação', exact: true }).click()
        await page.getByRole('button', { name: nome }).first().click()
        await page.keyboard.press('Escape')
      } else await page.getByRole('button', { name: nome }).first().click()
    }
    // Quando o sistema já tem a mesma aparência desejada, o controle binário
    // precisa passar pelo tema oposto para transformar a escolha em explícita.
    if (await html.getAttribute('data-theme') === value) {
      await clicar(value === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro')
    }
    const nome = value === 'dark' ? 'Ativar modo escuro' : 'Ativar modo claro'
    await clicar(nome)
  }
  async function contrast(label) {
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().endTime !== Infinity).map(animation => animation.finished.catch(() => {})))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    const failures = await page.evaluate(() => {
      const rgb = value => (value.match(/[\d.]+/g) ?? []).map(Number)
      const blend = (top, bottom) => top.slice(0, 3).map((value, index) => value * (top[3] ?? 1) + bottom[index] * (1 - (top[3] ?? 1)))
      const luminance = color => color.map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4 }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
      return [...document.querySelectorAll('button:not(:disabled), a.arc-button')].flatMap(element => {
        if (!element.getClientRects().length || (!element.textContent.trim() && !element.matches('.mobile-header button'))) return []
        const ancestors = []
        for (let current = element; current; current = current.parentElement) ancestors.unshift(current)
        const background = ancestors.reduce((color, ancestor) => blend(rgb(getComputedStyle(ancestor).backgroundColor), color), [255, 255, 255])
        const style = getComputedStyle(element)
        const foreground = blend(rgb(style.color), background)
        const light = luminance(foreground), dark = luminance(background)
        const ratio = (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05)
        const large = !element.textContent.trim() || parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700)
        return ratio + .01 < (large ? 3 : 4.5) ? [{ text: (element.textContent.trim() || element.getAttribute('aria-label')).slice(0, 90), ratio: +ratio.toFixed(2), foreground: style.color, background: style.backgroundColor }] : []
      })
    })
    contrastIssues.push(...failures.map(failure => ({ label, ...failure })))
  }
  // The first paint and login controls share the same theme, before authentication.
  await page.evaluate(() => localStorage.removeItem('arc-crm.tema'))
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(base + '/login')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByLabel('E-mail', { exact: true }).fill('tema@example.invalid')
  await page.getByLabel('Senha', { exact: true }).fill('rascunho-local')
  for (const selected of ['light', 'dark']) {
    await theme(selected)
    await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue('tema@example.invalid')
    await expect(page.getByLabel('Senha', { exact: true })).toHaveValue('rascunho-local')
    await contrast(`login ${selected}`)
    await screenshot(`login-${selected}`)
  }
  await page.evaluate(() => localStorage.setItem('arc-crm.tema', 'invalid'))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  // Explicit themes, device preference, reload, preserved form/filter state.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(base + '/configuracoes')
  await theme('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Ativar modo claro' }).last()).toBeVisible()
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await theme('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.goto(base + '/crm')
  await page.getByLabel('Buscar oportunidades').fill('Site')
  await theme('light')
  await expect(page.getByLabel('Buscar oportunidades')).toHaveValue('Site')
  await page.goto(base + `/conversas?lead=${leadId}`)
  const draft = page.getByRole('textbox', { name: 'Resposta ao contato' })
  await draft.fill('Rascunho mantido ao mudar o tema.')
  await theme('dark')
  await expect(draft).toHaveValue('Rascunho mantido ao mudar o tema.')
  console.log('PASS themes: persistence, system changes, explicit preference, filters and draft preserved')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 })
    for (const selected of ['light', 'dark']) {
      await theme(selected)
      for (const path of routes) {
        await navigate(path)
        await expect(page.locator('html')).toHaveAttribute('data-theme', selected)
        await noOverflow(`${path} ${width} ${selected}`)
        if (width === 1440) await contrast(`${path} ${selected}`)
        if (['/', `/conversas?lead=${leadId}`, '/agenda', '/crm'].includes(path) && [390, 1440].includes(width)) {
          await screenshot(`${path === '/' ? 'dashboard' : path.split('?')[0].slice(1)}-${width}-${selected}`)
        }
        if (path === '/agenda') {
          await expect(page.locator('.calendar-week')).toBeVisible()
          await expect(page.locator('.calendar-week button').filter({ hasText: 'Contato de teste' })).toHaveCount(1)
          await page.getByRole('button', { name: 'Mês', exact: true }).click()
          await expect(page.locator('.calendar-month')).toBeVisible()
          await noOverflow(`agenda-month ${width} ${selected}`)
        }
      }
      const conversation = page.getByRole('log', { name: 'Histórico da conversa' })
      await expect(conversation).toBeVisible()
      if (width < 1280) {
        await page.getByRole('button', { name: 'Dados do contato', exact: true }).click()
        await expect(page.getByRole('dialog', { name: 'Dados do contato' })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('button', { name: 'Dados do contato', exact: true })).toBeFocused()
      }
      if (width <= 620) {
        await page.getByRole('button', { name: 'Voltar à lista de conversas' }).click()
        await expect(page.getByRole('heading', { name: 'Conversas', exact: true })).toBeVisible()
        await page.getByRole('textbox', { name: 'Buscar conversas' }).fill('inexistente-xyz')
        await expect(page.getByText('Nada encontrado', { exact: true })).toBeVisible()
        await page.getByRole('textbox', { name: 'Buscar conversas' }).fill('')
        await page.locator('.conversation-list button[aria-label]').filter({ hasText: 'Contato de teste' }).click()
        await expect(conversation).toBeVisible()
      }
      results.push({ width, theme: selected, routes: routes.length })
      console.log(`PASS design routes and conversation navigation: ${width}px / ${selected}`)
    }
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  // Keyboard navigation, native dialogs, focus restoration, and saving guard.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + '/projetos')
  const trigger = page.getByRole('button', { name: 'Editar projeto' }).first()
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Editar projeto' })
  await expect(dialog).toBeVisible()
  for (let index = 0; index < 14; index++) {
    await page.keyboard.press('Tab')
    assert(await dialog.evaluate(el => el.contains(document.activeElement)), 'Dialog must contain keyboard focus')
  }
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  // A save in flight must keep its dialog open, even with Escape or a backdrop click.
  let releaseSave
  const saveGate = new Promise(resolve => { releaseSave = resolve })
  const delayedSave = async route => {
    if (route.request().method() === 'PATCH') await saveGate
    await route.fallback()
  }
  await context.route('**/rest/v1/projetos?**', delayedSave)
  await trigger.click()
  await dialog.getByRole('button', { name: 'Salvar projeto' }).click()
  await expect(dialog).toHaveAttribute('aria-busy', 'true')
  await page.keyboard.press('Escape')
  await page.mouse.click(2, 2)
  await expect(dialog).toBeVisible()
  releaseSave()
  await expect(dialog).toBeHidden()
  await context.unroute('**/rest/v1/projetos?**', delayedSave)
  await page.getByRole('button', { name: 'Menu de navegação', exact: true }).click()
  for (let index = 0; index < 18; index++) {
    await page.keyboard.press('Tab')
    assert(await page.locator('#navegacao').evaluate(el => el.contains(document.activeElement)), 'Mobile menu must contain keyboard focus')
  }
  const account = page.getByRole('button', { name: 'Conta: Equipe Teste' })
  await account.click()
  await expect(page.locator('#account-menu a').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(account).toBeFocused()
  await expect(page.getByRole('dialog', { name: 'Menu de navegação' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Menu de navegação', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Menu de navegação', exact: true }).hover()
  await contrast('mobile menu focused and hovered')
  // 200% zoom: effective CSS layout viewport halves, including viewport height.
  await page.setViewportSize({ width: 720, height: 450 })
  for (const path of ['/', '/crm', '/configuracoes', `/conversas?lead=${leadId}`]) {
    await page.goto(base + path)
    await page.waitForTimeout(150)
    await noOverflow(`200% equivalent ${path}`)
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await navigate('/')
  const duration = await page.locator('.app-main').evaluate(el => {
    const animated = el.querySelector('[class*="fade-in"]')
    return animated ? parseFloat(getComputedStyle(animated).animationDuration) : 0
  })
  assert(duration <= .01, 'Reduced motion must suppress animations')

  // Real calendar controls and representative forms at the narrowest supported width.
  await page.setViewportSize({ width: 360, height: 780 })
  for (const selected of ['light', 'dark']) {
    await theme(selected)
    for (const [path, triggerName, dialogName] of [
      ['/agenda', 'Novo Agendamento', 'Nova reunião'],
      ['/equipe', 'Novo Profissional', 'Responsável e jornada'],
      [`/leads/${leadId}`, 'Nova oportunidade', 'Nova oportunidade'],
    ]) {
      await page.goto(base + path)
      await page.getByRole('button', { name: triggerName, exact: true }).click()
      const modal = page.getByRole('dialog', { name: dialogName, exact: true })
      await expect(modal).toBeVisible()
      const overflow = await modal.evaluate(el => [...el.querySelectorAll('div,form')].filter(item => item.clientWidth && item.scrollWidth > item.clientWidth + 1).map(item => ({ width: item.clientWidth, content: item.scrollWidth })))
      if (overflow.length) issues.push({ label: `${dialogName} 360 ${selected}`, overflow })
      await contrast(`${dialogName} ${selected}`)
      await screenshot(`modal-${path.split('/')[1]}-${selected}`)
      await page.keyboard.press('Escape')
      await expect(modal).toBeHidden()
    }
  }

  const originalName = fixtures.lead.nome_lead, originalValue = fixtures.opportunities[0].valor_proposta
  fixtures.lead.nome_lead = 'Contato com nome muito longo para verificar a leitura e a navegação em telas pequenas'
  fixtures.opportunities[0].valor_proposta = 999999999999.99
  for (const path of ['/', '/crm', '/projetos', '/leads', `/leads/${leadId}`, `/conversas?lead=${leadId}`]) {
    await page.goto(base + path)
    await page.locator('.app-main h1').waitFor({ state: 'attached' })
    await page.waitForTimeout(150)
    await noOverflow(`long content ${path}`)
  }
  fixtures.lead.nome_lead = originalName
  fixtures.opportunities[0].valor_proposta = originalValue
  writeFileSync(`${out}/results.json`, JSON.stringify({ results, issues, contrastIssues, complete: false }, null, 2))
  assert.deepEqual(issues, [], 'No accidental page overflow; tables and boards scroll internally')
  assert.deepEqual(contrastIssues, [], 'Enabled text controls must meet WCAG AA contrast')

  // Advance browser timers to exercise the global warning without waiting a minute.
  setConnectionState('desconectado')
  await page.clock.install()
  const disconnected = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/conexao'))
  await page.goto(base + '/crm')
  await disconnected
  await expect(page.locator('.account-name strong')).toHaveText('Equipe Teste')
  await page.getByText('Site segunda compra', { exact: true }).waitFor({ state: 'attached' })
  await page.clock.runFor(61000)
  await expect(page.getByText('O WhatsApp da agência está desconectado', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Menu de navegação', exact: true }).click()
  await expect(account).toBeInViewport()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: 'Funil de oportunidades' })).toBeInViewport()
  await noOverflow('global warning with mobile navigation')
  setConnectionState('conectado')
  await page.clock.resume()

  // Theme initialization must work before React even when browser storage fails.
  await context.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem
    Storage.prototype.getItem = function(key) { if (key === 'arc-crm.tema') throw Error('Storage unavailable'); return get.call(this, key) }
    Storage.prototype.setItem = function(key, value) { if (key === 'arc-crm.tema') throw Error('Storage unavailable'); return set.call(this, key, value) }
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(base + '/configuracoes')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await theme('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('status').filter({ hasText: 'Preferência válida nesta sessão.' }).last()).toBeVisible()
  writeFileSync(`${out}/results.json`, JSON.stringify({ results, issues, contrastIssues, complete: true }, null, 2))
  assert.deepEqual(issues, [], 'No accidental page overflow; tables and boards scroll internally')
  assert.deepEqual(contrastIssues, [], 'Enabled text controls must meet WCAG AA contrast')
  console.log('PASS design: populated calendars, dialogs, save guard, keyboard, nested menus, contrast, long content, global warning, storage unavailable, reduced motion and zoom layout')
}

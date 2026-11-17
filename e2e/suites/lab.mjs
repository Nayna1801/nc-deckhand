// Laboratorio en la web compilada: el simulador de Python corre dentro del navegador (Pyodide en un Worker), con la misma
// Content-Security-Policy que la web publicada. No usa red externa: Pyodide y el motor se sirven desde la propia web.
import { chromium } from 'playwright'
import fs from 'node:fs'
import { BASE } from '../config.mjs'

let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }
const BOOT = 120_000 // descargar ~12 MB y arrancar Python puede tardar en una máquina lenta
const browser = await chromium.launch()
const errors = []

const mk = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true, ...opts })
  const p = await ctx.newPage()
  p.setDefaultTimeout(15_000)
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  p.on('console', (m) => { const t = m.text(); if (/content security policy/i.test(t) || (m.type() === 'error' && !/status of 4\d\d/.test(t))) errors.push('console: ' + t) })
  return { ctx, p }
}
const decksLoaded = (p) => p.waitForFunction(() => document.querySelectorAll('.lab-form select option').length > 4, null, { timeout: BOOT })
const settle = async (p) => {
  await p.waitForTimeout(60)
  await p.waitForFunction(() => !document.querySelector('.pt-busy'), null, { timeout: BOOT })
}

/* 1. se llega desde el menú, avisa mientras descarga y carga los mazos del simulador */
const { ctx, p } = await mk()
const requests = []
p.on('request', (r) => requests.push(r.url()))
await p.goto(BASE)
await p.waitForSelector('.tile')
ok(!requests.some((u) => /pyodide|lab\/engine/.test(u)), 'fuera del Laboratorio no se descarga nada del simulador')
await p.locator('.topbar nav a', { hasText: 'Laboratorio' }).click()
await p.waitForSelector('.lab')
const loading = await p.locator('.lab-loading').innerText({ timeout: 5000 }).catch(() => '')
ok(/simulador/i.test(loading), `mientras se prepara avisa de que está descargando o arrancando el simulador («${loading.slice(0, 40)}…»)`)
await decksLoaded(p)
ok((await p.locator('.lab-loading').count()) === 0, 'al terminar de arrancar desaparece el aviso')
const groups = await p.locator('.lab-form select').first().locator('optgroup').evaluateAll((els) => els.map((e) => e.label))
ok(groups.includes('Mazos de deckforge') && groups.includes('Meta'), `los desplegables traen los mazos del simulador (${groups.join(', ')})`)
ok(requests.every((u) => new URL(u).origin === new URL(BASE).origin || /fonts\.(googleapis|gstatic)\.com|supabase\.co/.test(u)), 'el simulador se descarga de la propia web, sin terceros')

/* 2. ver una simulación */
await p.getByLabel('J1 (empieza)').selectOption('meta/bbg_control')
await p.getByLabel('J2').selectOption('meta/red_aggro')
await p.getByRole('button', { name: 'Simular', exact: true }).click()
await p.waitForSelector('.lab-result', { timeout: BOOT })
const result = await p.locator('.lab-result').innerText()
ok(/(Gana J[12]|Empate) en el turno \d+ · semilla 1 · \d+ pasos/.test(result), `«Simular» juega una partida entera y la enseña (${result})`)
ok((await p.locator('.rp-line').count()) > 20, 'con su consola paso a paso')

/* 3. jugar contra el piloto: partida entera, sin que la página se congele */
await p.getByRole('tab', { name: 'Jugar contra el piloto' }).click()
await p.getByLabel('Tu mazo').selectOption('meta/bbg_control')
await p.getByLabel('Mazo del piloto').selectOption('meta/red_aggro')
await p.getByRole('button', { name: 'Empezar partida' }).click()
await p.waitForSelector('.pt-actions', { timeout: BOOT })
ok(/mulligan|mano/i.test(await p.locator('.pt-ap-title').innerText()), 'la partida empieza preguntando por la mano inicial')
ok((await p.locator('.pt-side.mine .pt-hand .pt-card').count()) >= 5, 'se ve tu mano')
const title = () => p.locator('.pt-ap-title').innerText().catch(() => '')
let asks = 0
let sold = 0
for (; asks < 500 && !(await p.getByText('Repaso de la partida').count()); asks++) {
  const t = await title()
  if (/Tu turno/i.test(t)) {
    // alterna: vender o jugar una carta si se puede, y si no terminar el turno
    const can = p.locator('.pt-side.mine .pt-card.can')
    let did = false
    if (asks % 3 !== 0 && (await can.count())) {
      await can.first().click()
      const o = p.locator('.pt-actions .pt-ap-block .pt-opt')
      const pick = (await o.allInnerTexts()).findIndex((x) => /Jugar|Vender|Atacar/i.test(x))
      if (pick >= 0) {
        await o.nth(pick).click()
        did = true
        sold++
      }
    }
    if (!did) await p.locator('.pt-ap-end .pt-opt').click()
  } else if (/Pagas/i.test(t)) {
    await p.locator('.pt-actions .pt-ap-block .pt-opt').first().click()
  } else {
    await p.locator('.pt-actions .pt-opt:not([disabled])').first().click()
  }
  await settle(p)
}
await p.waitForSelector('text=Repaso de la partida', { timeout: BOOT })
const verdict = await p.locator('.pb-result h3').innerText()
ok(/ganado|Empate/i.test(verdict) && asks > 15 && sold > 3, `se juega una partida entera contra el piloto (${asks} decisiones; ${verdict})`)
ok((await p.locator('.rp-line').count()) > 20, 'al terminar se puede repasar la partida')

/* 4. el registro de decisiones se descarga con el mismo formato que guarda el simulador en local */
const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: /Descargar partida/ }).click()])
const doc = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'))
ok(/^\d{8}-\d{6}_seed1\.json$/.test(dl.suggestedFilename()), `el fichero se llama como los de data/human (${dl.suggestedFilename()})`)
ok(doc.version === 2 && doc.seed === 1 && doc.decisions.length >= asks - 2 && doc.game.steps.length > 20 && doc.decks.length === 2, 'lleva las decisiones, los mazos y la partida')
const plans = Object.values(doc.plans)
ok(plans.length > 2 && plans.every((x) => Array.isArray(x) && x.length > 0), `y lo que habría hecho el piloto en cada turno tuyo (${plans.length} turnos)`)

/* 5. otra partida y abandonar */
await p.getByRole('button', { name: /Otra partida/ }).click()
await p.waitForSelector('.pt-actions', { timeout: BOOT })
await p.getByRole('button', { name: 'Abandonar' }).click()
await p.waitForSelector('.lab-form')
ok((await p.locator('.pt').count()) === 0 && (await p.locator('[role=alert]').count()) === 0, 'se puede abandonar una partida y volver a elegir mazos')
await ctx.close()

/* 6. si el simulador no se puede descargar, se dice y la web sigue funcionando */
{
  const { ctx, p } = await mk()
  await ctx.route('**/lab/engine.json*', (r) => r.fulfill({ status: 404, body: 'no' }))
  await p.goto(BASE + '#/lab')
  const alert = p.locator('.lab [role=alert]')
  await alert.waitFor({ timeout: BOOT })
  ok(/No se pudo conectar con el simulador/.test(await alert.innerText()) && /Recarga/.test(await alert.innerText()), 'sin el motor: aviso claro y qué hacer')
  ok((await p.locator('.lab-loading').count()) === 0, 'y no se queda «descargando» para siempre')
  await p.locator('.topbar nav a', { hasText: 'Cartas' }).click()
  await p.waitForSelector('.tile')
  ok(true, 'el resto de la web sigue funcionando')
  await ctx.close()
}
const expected = errors.filter((e) => !/404|engine\.json/.test(e))

/* 7. móvil: el menú y la página caben, y se puede simular */
for (const w of [320, 390]) {
  const { ctx, p } = await mk({ viewport: { width: w, height: 760 }, hasTouch: true, isMobile: true })
  await p.goto(BASE + '#/lab')
  await decksLoaded(p)
  const over = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok((await over()) <= 1, `${w}px · Laboratorio: sin desbordamiento horizontal (${await over()}px)`)
  await p.getByRole('button', { name: 'Simular', exact: true }).tap()
  await p.waitForSelector('.lab-result', { timeout: BOOT })
  ok((await over()) <= 1, `${w}px · partida simulada: sin desbordamiento horizontal (${await over()}px)`)
  await ctx.close()
}

ok(expected.length === 0, `sin errores de consola ni avisos de la política de seguridad${expected.length ? ': ' + expected.slice(0, 3).join(' | ') : ''}`)
await browser.close()
process.exit(failed ? 1 : 0)

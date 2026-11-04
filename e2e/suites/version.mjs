import { chromium } from 'playwright'
import { BASE, DIST_E2E } from '../config.mjs'
import { join } from 'node:path'
import fs from 'node:fs'

const dist = JSON.parse(fs.readFileSync(join(DIST_E2E, 'version.json'), 'utf8'))
let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }
const browser = await chromium.launch()
const errors = []
const mk = async (versionHandler) => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  if (versionHandler) await ctx.route('**/version.json*', versionHandler)
  const p = await ctx.newPage(); p.setDefaultTimeout(8000)
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  p.on('console', (m) => { const t = m.text(); if (/content security policy/i.test(t) || (m.type() === 'error' && !/status of 4\d\d/.test(t))) errors.push('console: ' + t) })
  return { ctx, p }
}

/* 1. el pie enseña la versión y no hay aviso si coincide */
{
  const { ctx, p } = await mk(null)
  await p.goto(BASE); await p.waitForSelector('.tile')
  const foot = await p.locator('.foot').innerText()
  ok(new RegExp('versión ' + dist.version, 'i').test(foot), `el pie muestra "Versión ${dist.version}" (la de esta compilación)`)
  ok(/compilada el/i.test((await p.locator('.foot .build').getAttribute('title')) || ''), 'con la fecha de compilación al pasar el ratón')
  await p.waitForTimeout(600)
  ok((await p.locator('.banner-update').count()) === 0, 'misma versión publicada: no hay aviso')
  await ctx.close()
}

/* 2. hay una versión más nueva publicada -> aviso, y recargar funciona */
{
  const { ctx, p } = await mk((r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'zzzzzzz', built: '2099-01-01T00:00:00Z' }) }))
  await p.goto(BASE); await p.waitForSelector('.tile')
  await p.locator('.banner-update').waitFor()
  ok(/versión nueva/i.test(await p.locator('.banner-update').innerText()), 'versión distinta publicada: aviso "Hay una versión nueva de la web"')
  await p.evaluate(() => { window.__antes = 1 })
  await Promise.all([p.waitForEvent('load'), p.getByRole('button', { name: 'Recargar ahora' }).click()])
  ok((await p.evaluate(() => window.__antes)) === undefined, '"Recargar ahora" recarga la página')
  await ctx.close()
}

/* 3. pestaña abierta mucho tiempo: al volver a ella se comprueba de nuevo */
{
  let served = dist.version
  const { ctx, p } = await mk((r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: served, built: 'x' }) }))
  await p.goto(BASE); await p.waitForSelector('.tile'); await p.waitForTimeout(500)
  ok((await p.locator('.banner-update').count()) === 0, 'pestaña abierta con la versión al día: sin aviso')
  served = 'nueva01' // se publica una versión nueva mientras la pestaña sigue abierta
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await p.locator('.banner-update').waitFor()
  ok(true, 'al volver a la pestaña tras publicarse otra versión, aparece el aviso (sin recargar a mano)')
  await ctx.close()
}

/* 4. robustez: version.json inexistente o corrupto no rompe nada */
for (const [name, h] of [['inexistente (404)', (r) => r.fulfill({ status: 404, body: 'no' })], ['corrupto', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{no es json' })], ['con tipo inesperado', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: { x: 1 } }) })]]) {
  const { ctx, p } = await mk(h)
  await p.goto(BASE); await p.waitForSelector('.tile'); await p.waitForTimeout(500)
  ok((await p.locator('.banner-update').count()) === 0 && (await p.locator('.tile').count()) === 150, `version.json ${name}: la web sigue funcionando y no avisa en falso`)
  await ctx.close()
}

console.log(errors.length ? 'ERRORES: ' + [...new Set(errors)].join(' | ') : 'sin errores de consola ni violaciones de CSP')
if (errors.length) failed++
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close(); process.exit(failed ? 1 : 0)

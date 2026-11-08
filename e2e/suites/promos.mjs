import { chromium } from 'playwright'
import { BASE, CARDS } from '../config.mjs'
import { newSession } from '../lib/mock.mjs'
import { pick, results } from '../lib/helpers.mjs'
import { P_BY_SET } from '../lib/data.mjs'

let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const browser = await chromium.launch()
const { page, store, errors } = await newSession(browser, { legacy: false })
page.setDefaultTimeout(10000)
await page.goto(BASE); await page.waitForSelector('.tile')
await page.getByRole('button', { name: 'Por impresión' }).click()

/* ---- los sets promocionales se listan como set ---- */
for (const set of ['Set 1 Promos', 'Judge Promos', 'Pre-Release Retail', 'Night City Showdown S1']) {
  await pick(page, 'Set', set)
  ok((await results(page)) === P_BY_SET.get(set), `${set}: ${P_BY_SET.get(set)} impresiones listadas (${await results(page)})`)
  await pick(page, 'Set', set) // desmarcar
}

/* ---- y como variante de arte: los Pre-Release son un diseño propio ---- */
await pick(page, 'Set', 'Pre-Release Retail')
const n = P_BY_SET.get('Pre-Release Retail')
await page.getByRole('checkbox', { name: /Solo artes alternativos/ }).check()
await page.waitForTimeout(150)
ok((await results(page)) === n, `con «Solo artes alternativos» siguen saliendo los ${n} Pre-Release (son un diseño propio, no el base)`)
ok((await page.locator('.print-tag.approx').count()) === n, 'cada uno indica que la imagen es aproximada (la promo lleva una marca que no tenemos)')

// contar un Pre-Release escribe un arte propio y Beta y Retail cuentan juntos
await pick(page, 'Set', 'Pre-Release Beta')
const royce = CARDS.find((c) => c.id === 'royce_psycho_on_the_edge')
const tiles = page.locator('.tile', { has: page.locator(`[aria-label^="${royce.displayName}"]`) })
ok((await tiles.count()) === 2, 'Royce sale dos veces: su Pre-Release Retail y su Pre-Release Beta')
await tiles.nth(0).getByRole('button', { name: 'Añadir uno' }).click()
await page.waitForTimeout(500)
const row = store.collection.get(royce.id)
ok(row?.arts?.['print:prerelease'] === 1, `se guarda como arte propio «print:prerelease» (${JSON.stringify(row?.arts)})`)
ok((await tiles.locator('.tile-badge', { hasText: '×1' }).count()) === 2, 'y las dos fichas (Beta y Retail) muestran ×1: cuentan juntas')
ok((row?.quantity ?? 0) === 0, 'sin tocar las copias del diseño base')

// y en la colección suma como arte alternativo/promo
await page.goto(BASE + '#/collection'); await page.waitForSelector('.stats-row')
const stat = page.locator('.stat', { hasText: 'artes alternativos' })
ok(/^1\s*\//.test((await stat.locator('strong').innerText()).trim()), 'la estadística de artes alternativos y promos cuenta 1')

// la ficha de la carta lo ofrece para contar
await page.goto(BASE + '#/'); await page.waitForSelector('.tile')
await page.locator('input[type=search]').fill(`name:"${royce.displayName}"`); await page.waitForTimeout(450)
await page.locator('.tile-art').first().click(); await page.locator('.modal').waitFor()
ok(/Promoci[oó]n/i.test(await page.locator('.modal .art-counts').innerText()), 'en el detalle hay un contador «Promoción» para el Pre-Release')

ok(errors.length === 0, 'sin errores de página' + (errors.length ? ': ' + errors.join(' | ') : ''))
await browser.close()
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
process.exit(failed ? 1 : 0)

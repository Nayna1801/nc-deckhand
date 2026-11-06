import { chromium } from 'playwright'
import { BASE } from '../config.mjs'
import { newSession } from '../lib/mock.mjs'
import { collect, pick, pickMany, results } from '../lib/helpers.mjs'
import { N, P_BY_SET, P_GROUPS, P_TOTAL, printsOf as dataPrints } from '../lib/data.mjs'
import { CARDS } from '../config.mjs'

let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const browser = await chromium.launch()
const { page, errors } = await newSession(browser, { legacy: false })
page.on('console', (m) => m.type() === 'error' && !/ERR_NO_BUFFER_SPACE|fonts\.g/.test(m.text()) && errors.push('console: ' + m.text()))
const count = () => results(page)

await page.goto(BASE); await page.waitForSelector('.tile')
ok((await count()) === N, `por defecto: una ficha por carta (${N})`)

/* ---- por impresión ---- */
await page.getByRole('button', { name: 'Por impresión' }).click()
await page.waitForFunction((n) => Number(document.querySelector('[data-results]')?.getAttribute('data-results')) > n, N)
const total = await count()
ok(total === P_TOTAL, `por impresión: ${total} fichas (una por set y número en inglés, más los artes sin set)`)
const heads = [...new Set(await collect(page, (pg) => pg.locator('.set-head span').allInnerTexts()))]
ok(heads.length === P_GROUPS && new Set(heads).size === heads.length, `${P_GROUPS} grupos (sets y artes sin set), cada uno en un bloque propio (${heads.length})`)
ok((await page.locator('.print-tag').count()) === (await page.locator('.tile').count()), 'cada ficha lleva su número de coleccionista')
await page.getByRole('button', { name: 'Por carta' }).click()
ok((await count()) === N, `volver a "Por carta" restablece las ${N}`)

/* ---- un set elegido lista las impresiones de ese set ---- */
await pick(page, 'Set', 'Set 1 Promos')
ok((await count()) === P_BY_SET.get('Set 1 Promos'), `Set 1 Promos -> ${P_BY_SET.get('Set 1 Promos')} fichas de ese set (no las versiones base)`)
ok(await page.getByRole('button', { name: 'Por carta' }).isDisabled(), '"Por carta" queda desactivado con un set elegido')
const adamTile = page.locator('.tile', { has: page.locator('[aria-label^="Adam Smasher: Ender of Legends"]') })
ok((await adamTile.count()) === 1, 'aparece Adam Smasher: Ender of Legends en Set 1 Promos')
const src = await adamTile.locator('img').getAttribute('src')
ok(/adam_smasher_ender_of_legends__prm01_008\.webp$/.test(src), `con la imagen de ese promo (${src.split('/').pop()})`)
ok(/#008/.test(await adamTile.locator('.print-tag').innerText()), 'y su número #008')

/* ---- detalle: impresión de partida y salto a las otras ---- */
await adamTile.locator('.tile-art').click()
const modal = page.locator('.modal'); await modal.waitFor()
ok(/Set 1 Promos · #008/.test(await modal.locator('.meta').innerText()), 'el detalle abre en la impresión pulsada (Set 1 Promos #008)')
const modalSrc = () => modal.locator('.modal-img').getAttribute('src')
ok(/prm01_008/.test(await modalSrc()), 'con su imagen')
ok((await modal.locator('.print-row.current').count()) === 1, 'una impresión marcada como actual')
const rows = modal.locator('.print-row')
const adamPrints = dataPrints(CARDS.find((c) => c.id === 'adam_smasher_ender_of_legends')).length
ok((await rows.count()) === adamPrints, `lista las ${await rows.count()} impresiones de la carta (${adamPrints} en los datos)`)
await rows.filter({ hasText: 'Welcome to Night City — Beta' }).filter({ hasText: 'β141' }).locator('.print-btn').click()
ok(/Beta · #β141/.test(await modal.locator('.meta').innerText()), 'al pulsar Beta cambia a la impresión Beta #β141')
ok(/welcometonightcitybeta_141/.test(await modalSrc()), 'y su imagen')
await rows.filter({ hasText: 'ORIGINAL' }).locator('.print-btn').click()
ok(/Welcome to Night City · #001/.test(await modal.locator('.meta').innerText()), 'saltar a la original (#001)')
ok(!/__/.test(await modalSrc()), 'con la imagen de la carta original')
await modal.locator('.thumb').nth(1).click()
ok((await modal.locator('.print-row.current').count()) === 1, 'elegir una miniatura de arte también marca su impresión')
await page.keyboard.press('Escape')
await adamTile.locator('.tile-art').click()
await modal.waitFor()
ok(/Set 1 Promos · #008/.test(await modal.locator('.meta').innerText()) && /prm01_008/.test(await modalSrc()), 'al reabrir la carta vuelve a la impresión pulsada, no a la última elegida dentro del detalle')
await page.keyboard.press('Escape')

/* ---- varios sets ---- */
await pick(page, 'Set', '')
await pickMany(page, 'Set', ['Set 1 Promos', 'Judge Promos'])
ok((await count()) === P_BY_SET.get('Set 1 Promos') + P_BY_SET.get('Judge Promos'), 'Set 1 Promos + Judge Promos juntos')
await pick(page, 'Set', '')
ok((await count()) === N, 'al quitar el set vuelve la vista por carta')

/* ---- con las imágenes reales de cada impresión ya no quedan fichas aproximadas ---- */
await pick(page, 'Set', 'Edgerunner Open S 1')
ok((await count()) === P_BY_SET.get('Edgerunner Open S 1'), `Edgerunner Open S 1 -> ${P_BY_SET.get('Edgerunner Open S 1')} fichas`)
const approx = (await collect(page, async (pg) => [await pg.locator('.print-tag.approx').count()])).reduce((a, b) => a + b, 0)
ok(approx === 0, 'ninguna ficha de ese set se marca como aproximada: todas tienen su imagen')
await pick(page, 'Set', '')

/* ---- promos Judge: cada una con su propia imagen (la que lleva la marca JUDGE) ---- */
await pick(page, 'Set', 'Judge Promos')
ok((await count()) === 3, 'Judge Promos -> 3 fichas')
const judgeSrcs = await page.locator('.tile img').evaluateAll((els) => els.map((i) => i.getAttribute('src')))
ok(judgeSrcs.length === 3 && judgeSrcs.every((s) => /judgepromos_/.test(s)), 'cada una usa su imagen de promo (no la de la carta normal)')
ok((await page.locator('.print-tag.approx').count()) === 0, 'y ninguna se marca como aproximada')
await page.locator('.tile-art').first().click()
await page.locator('.modal').waitFor()
ok(/judgepromos_/.test(await page.locator('.modal-img').getAttribute('src')), 'el detalle muestra también la imagen de la promo')
await page.keyboard.press('Escape')
await pick(page, 'Set', '')

/* ---- lista y orden por coste ---- */
await page.getByRole('button', { name: 'Por impresión' }).click()
await page.getByRole('button', { name: /Lista/ }).click()
ok((await results(page)) === P_TOTAL && (await page.locator('.crow').count()) === 48, `vista lista por impresión: ${P_TOTAL} impresiones, 48 filas por página`)
ok(/Night City|Embracing|Heist|Demo|Open|Brawl|Showdown|Promos|Toppers|Pre-Release/.test(await page.locator('.crow').first().innerText()), 'cada fila indica su set')
await page.getByRole('button', { name: /Galería/ }).click()
await pick(page, 'Orden', 'cost')
ok((await page.locator('.set-head').count()) === 0, 'con otro orden no hay encabezados de set')
ok((await count()) === P_TOTAL, 'pero siguen todas las impresiones')

/* ---- móvil ---- */
await page.setViewportSize({ width: 390, height: 800 })
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
ok(overflow <= 1, `móvil: sin scroll horizontal (${overflow}px)`)
ok(errors.length === 0, 'sin errores de página' + (errors.length ? ': ' + errors.join(' | ') : ''))

/* ---- con sesión: el diseño base cuenta junto y cada arte alternativo por separado (ver suite arts) ---- */

console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close(); process.exit(failed ? 1 : 0)

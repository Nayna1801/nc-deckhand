import { chromium } from 'playwright'
import { BASE } from '../config.mjs'
import { newSession } from '../lib/mock.mjs'
import { pick, pickMany } from '../lib/helpers.mjs'

let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const browser = await chromium.launch()
const { page, errors } = await newSession(browser, { legacy: false })
page.on('console', (m) => m.type() === 'error' && !/ERR_NO_BUFFER_SPACE|fonts\.g/.test(m.text()) && errors.push('console: ' + m.text()))
const count = () => page.locator('.tile').count()

await page.goto(BASE); await page.waitForSelector('.tile')
ok((await count()) === 150, 'por defecto: una ficha por carta (150)')

/* ---- por impresión ---- */
await page.getByRole('button', { name: 'Por impresión' }).click()
await page.waitForFunction(() => document.querySelectorAll('.tile').length > 150)
const total = await count()
ok(total === 398, `por impresión: ${total} fichas (una por set y número en inglés, más 9 artes sin set)`)
const heads = await page.locator('.set-head span').allInnerTexts()
ok(heads.length === 14 && new Set(heads).size === heads.length, `14 grupos (13 sets y los artes sin set), cada uno en un bloque propio (${heads.length})`)
ok((await page.locator('.print-tag').count()) === total, 'cada ficha lleva su número de coleccionista')
await page.getByRole('button', { name: 'Por carta' }).click()
ok((await count()) === 150, 'volver a "Por carta" restablece las 150')

/* ---- un set elegido lista las impresiones de ese set ---- */
await pick(page, 'Set', 'Set 1 Promos')
ok((await count()) === 2, 'Set 1 Promos -> 2 fichas de ese set (no las versiones base)')
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
ok((await rows.count()) === 6, `lista las ${await rows.count()} impresiones de la carta`)
await rows.filter({ hasText: 'Beta' }).locator('.print-btn').click()
ok(/Beta · #β141/.test(await modal.locator('.meta').innerText()), 'al pulsar Beta cambia a la impresión Beta #β141')
ok(/welcometonightcitybeta_141/.test(await modalSrc()), 'y su imagen')
await rows.filter({ hasText: 'ORIGINAL' }).locator('.print-btn').click()
ok(/Welcome to Night City · #001/.test(await modal.locator('.meta').innerText()), 'saltar a la original (#001)')
ok(!/__/.test(await modalSrc()), 'con la imagen de la carta original')
await modal.locator('.thumb').nth(1).click()
ok((await modal.locator('.print-row.current').count()) === 1, 'elegir una miniatura de arte también marca su impresión')
await page.keyboard.press('Escape')

/* ---- varios sets ---- */
await pick(page, 'Set', '')
await pickMany(page, 'Set', ['Set 1 Promos', 'Judge Promos'])
ok((await count()) === 5, 'Set 1 Promos + Judge Promos -> 5 fichas')
await pick(page, 'Set', '')
ok((await count()) === 150, 'al quitar el set vuelve la vista por carta')

/* ---- reimpresiones sin imagen propia: aviso ---- */
await pick(page, 'Set', 'Edgerunner Open S 1')
ok((await count()) === 53, 'Edgerunner Open S 1 -> 53 fichas')
const approx = await page.locator('.print-tag.approx').count()
ok(approx > 0, `${approx} fichas marcadas con ≈ (imagen aproximada) y aviso en su título`)
ok(/Arte (probable|distinto)/.test((await page.locator('.print-tag.approx').first().getAttribute('title')) ?? ''), 'el título explica por qué')
await pick(page, 'Set', '')

/* ---- lista y orden por coste ---- */
await page.getByRole('button', { name: 'Por impresión' }).click()
await page.getByRole('button', { name: /Lista/ }).click()
ok((await page.locator('.crow').count()) === 398, 'vista lista por impresión: 398 filas')
ok(/Night City|Embracing|Heist|Demo|Open|Brawl|Showdown|Promos|Toppers|Pre-Release/.test(await page.locator('.crow').first().innerText()), 'cada fila indica su set')
await page.getByRole('button', { name: /Galería/ }).click()
await pick(page, 'Orden', 'cost')
ok((await page.locator('.set-head').count()) === 0, 'con otro orden no hay encabezados de set')
ok((await count()) === 398, 'pero siguen todas las impresiones')

/* ---- móvil ---- */
await page.setViewportSize({ width: 390, height: 800 })
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
ok(overflow <= 1, `móvil: sin scroll horizontal (${overflow}px)`)
ok(errors.length === 0, 'sin errores de página' + (errors.length ? ': ' + errors.join(' | ') : ''))

/* ---- con sesión: el diseño base cuenta junto y cada arte alternativo por separado (ver suite arts) ---- */

console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close(); process.exit(failed ? 1 : 0)

import { chromium } from 'playwright'
import { BASE, DECKS, SHOTS } from '../config.mjs'
import { newSession } from '../lib/mock.mjs'
import { pick, results, shown } from '../lib/helpers.mjs'
import fs from 'node:fs'

const shots = SHOTS
const decks = DECKS
const realDeckText = decks[3].text
let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const browser = await chromium.launch()

/* ================= escenario 1: base de datos con migración v2 ================= */
{
  const { page, store, errors } = await newSession(browser, { legacy: false })
  await page.goto(BASE); await page.waitForSelector('.tile')
  ok((await page.locator('.tile-foot .stepper').count()) === (await page.locator('.tile').count()) && (await page.locator('.tile').count()) === 48, 'con sesión: stepper de cantidad en cada carta de la página')

  // 4 copias normales de la primera carta -> 3 activas + 1 bulk
  const add = page.locator('.tile').first().getByRole('button', { name: 'Añadir uno' })
  for (let i = 0; i < 4; i++) await add.click()
  await page.waitForTimeout(300)
  const badge = await page.locator('.tile').first().locator('.tile-badge').innerText()
  ok(/×4/.test(badge) && /B3/.test(badge), `las copias que pasan del playset (1 en una Legend) van a bulk (insignia "${badge}")`)
  const firstId = [...store.collection.keys()][0]
  ok(store.collection.get(firstId)?.quantity === 4, 'se guarda quantity=4 en la base de datos')

  // modal: Foil, un arte alternativo y estado
  await page.locator('.tile-art').first().click()
  const modal = page.locator('.modal')
  await modal.waitFor()
  ok(/playset: 1 de 1 copia/i.test(await modal.innerText()) && /sobran 3/i.test(await modal.innerText()), 'modal: Legend con 4 copias -> Playset 1 de 1 y sobran 3')
  await modal.getByRole('button', { name: /Mostrar/ }).click()
  await modal.locator('.inventory .row', { hasText: 'Foil' }).getByRole('button', { name: 'Añadir uno' }).click()
  ok((await modal.locator('.inventory .row', { hasText: /promo/i }).count()) === 0, 'no hay fila de "Promo / Full Art": cada arte tiene su contador')
  await modal.locator('.art-row').first().getByRole('button', { name: 'Añadir uno' }).click()
  await page.waitForTimeout(300)
  ok(/sobran 5/i.test(await modal.innerText()), 'Normal + Foil + un arte suman 6 -> sobran 5')
  await modal.locator('select').selectOption('played')
  await page.waitForTimeout(300)
  const row = store.collection.get(firstId)
  ok(row.quantity === 4 && row.qty_foil === 1 && Object.values(row.arts ?? {}).join() === '1' && row.condition === 'played', `se guardan versiones, arte y estado (${JSON.stringify({ q: row.quantity, f: row.qty_foil, a: row.arts, c: row.condition })})`)
  await page.keyboard.press('Escape')

  // colección: bulk + CSV
  await page.goto(BASE + '#/collection'); await page.waitForSelector('.stats-row')
  ok(/5\s*copias en bulk/i.test((await page.locator('.stats-row').innerText()).replace(/\n/g, ' ')), 'estadística: 5 copias en bulk')
  await page.getByRole('tab', { name: /Bulk/ }).click()
  ok((await page.locator('.panel .deck-row').count()) === 1 && /bulk ×5/i.test(await page.locator('.panel .deck-row').innerText()), 'pestaña Bulk lista la carta con ×5')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar bulk CSV' }).click()])
  const csv = fs.readFileSync(await dl.path(), 'utf8')
  ok(csv.startsWith('code,name,set,bulk_copies,condition') && /,5,Played$/m.test(csv), 'bulk.csv con estado "Played"')

  // importar texto en modo sumar: conserva foil/promo
  await page.fill('textarea', '2x 089 Saul Bright: Stormrider')
  await page.getByRole('button', { name: 'Importar', exact: true }).click()
  await page.waitForTimeout(400)
  ok(store.collection.get('saul_bright_stormrider')?.quantity === 2, 'importar en modo sumar añade copias Normal')
  ok(store.collection.get(firstId)?.qty_foil === 1, 'importar en modo sumar no pierde las copias Foil existentes')

  // lista de compra desde un mazo
  await page.goto(BASE + '#/decks'); await page.getByRole('button', { name: 'Importar texto' }).click()
  await page.fill('textarea', realDeckText); await page.getByRole('button', { name: 'Crear mazo' }).click()
  await page.waitForURL(/#\/decks\/.+/); await page.waitForTimeout(900)
  ok(store.decks.size === 1, 'el mazo se guarda en la tabla tcg_decks')
  ok(/te faltan \d+ carta/i.test(await page.locator('.editor-deck').innerText()), 'el editor indica las cartas que te faltan')
  ok((await page.locator('.slot .pill.bad', { hasText: 'no la tienes' }).count()) === 3, 'las 3 Legends marcadas como "no la tienes"')
  await page.goto(BASE + '#/collection'); await page.waitForSelector('.stats-row')
  await page.getByRole('tab', { name: /Para mis mazos/ }).click()
  const wishRows = await page.locator('.panel .deck-row').count()
  ok(wishRows > 10, `lista de compra con ${wishRows} cartas distintas`)
  const [csvDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar CSV' }).click()])
  const wcsv = fs.readFileSync(await csvDl.path(), 'utf8')
  ok(wcsv.split('\n').length - 1 === wishRows && wcsv.startsWith('code,name,set,rarity,needed,owned,missing,decks'), 'CSV de faltantes con una fila por carta')
  const [jsDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar JSON' }).click()])
  const parsed = JSON.parse(fs.readFileSync(await jsDl.path(), 'utf8'))
  ok(Array.isArray(parsed) && parsed.length === wishRows && parsed[0].missing > 0, 'JSON de faltantes válido')
  await page.screenshot({ path: shots + '/n4-wishlist.png' })

  console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'sin errores de página (escenario 1)')
}

/* ================= escenario 2: base de datos SIN migrar (legacy) ================= */
{
  const { page, store, errors } = await newSession(browser, { legacy: true })
  await page.goto(BASE); await page.waitForSelector('.tile')
  await page.locator('.tile').first().getByRole('button', { name: 'Añadir uno' }).click()
  await page.waitForTimeout(300)
  const w = store.writes.find((x) => x.table === 'tcg_collection')
  ok(w && !('qty_foil' in w.rows[0]) && w.rows[0].quantity === 1, 'sin migrar: solo escribe "quantity" (no rompe)')
  await page.locator('.tile-art').first().click()
  const txt = await page.locator('.modal').innerText()
  ok(/schema\.sql/.test(txt) && (await page.locator('.modal .inventory .row').count()) === 1, 'sin migrar: avisa de re-ejecutar schema.sql y oculta Foil/Promo')
  ok((await page.locator('.banner').count()) === 0, 'sin migrar: no muestra error al usuario')
  console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'sin errores de página (escenario 2)')
}

console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close()
process.exit(failed ? 1 : 0)

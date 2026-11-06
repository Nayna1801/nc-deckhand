import { chromium } from 'playwright'
import { BASE } from '../config.mjs'
import { pick, results, shown } from '../lib/helpers.mjs'
import { newSession } from '../lib/mock.mjs'
import { N } from '../lib/data.mjs'
let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }
const browser = await chromium.launch()
const { page, store, errors } = await newSession(browser, { legacy: false })
await page.goto(BASE); await page.waitForSelector('.tile')
const tiles = () => page.locator('.tile')

// --- Cartas: filtro "Las que me faltan" y pulsar + ---
await pick(page, 'Colección', 'missing')
ok((await results(page)) === N, `filtro "me faltan": ${N} cartas (no tienes ninguna)`)
const first = tiles().first()
const name = await first.locator('.tile-art').getAttribute('aria-label')
await first.getByRole('button', { name: 'Añadir uno' }).click()
await page.waitForTimeout(300)
ok((await results(page)) === N, 'al pulsar + la carta NO desaparece de la lista')
ok(/×1/.test(await tiles().first().locator('.tile-badge').innerText()), 'la carta muestra ×1 al instante')
ok(store.collection.size === 1, 'se guardó en la base de datos')
await tiles().first().getByRole('button', { name: 'Añadir uno' }).click()
await page.waitForTimeout(200)
ok((await results(page)) === N && /×2/.test(await tiles().first().locator('.tile-badge').innerText()), 'se puede seguir sumando (×2) sin que cambie la lista')
// cambiar de filtro refresca
await pick(page, 'Colección', 'all')
await pick(page, 'Colección', 'missing')
ok((await results(page)) === N - 1, `al volver a aplicar el filtro, la carta ya no figura como faltante (${N - 1})`)
await pick(page, 'Colección', 'owned')
ok((await results(page)) === 1, 'filtro "las que tengo": 1 carta')
await pick(page, 'Colección', 'all')

// --- Colección: sin pestaña "Me faltan", con enlace a Cartas ---
await page.goto(BASE + '#/collection'); await page.waitForSelector('.stats-row')
const tabs = await page.locator('[role=tab]').allInnerTexts()
ok(tabs.length === 3 && !tabs.some((t) => /me faltan/i.test(t)), `Colección tiene ${tabs.length} pestañas, sin "Me faltan": ${tabs.map((t) => t.replace(/\s+/g, ' ')).join(' | ')}`)
const link = page.locator('a.stat-link[href*="missing"]')
ok(new RegExp(String(N - 1)).test(await link.innerText()), `estadística "${N - 1} me faltan" con enlace`)
await link.click()
await page.waitForSelector('.tile')
ok((await shown(page, 'Colección')) === 'Las que me faltan' && (await results(page)) === N - 1, `el enlace abre Cartas ya filtrado por "me faltan" (${N - 1})`)

// --- Constructor: mismo comportamiento estable ---
await page.goto(BASE + '#/decks'); await page.getByRole('button', { name: 'Nuevo mazo' }).click(); await page.waitForURL(/#\/decks\/.+/)
await page.waitForSelector('.editor-cards .tile')
await pick(page, 'Colección', 'missing')
const before = await page.locator('.editor-cards .tile').count()
await page.locator('.editor-cards .tile').first().locator('.tile-art').click() // añade al mazo
const addedName = 'x'
ok((await page.locator('.editor-cards .tile').count()) === before, `constructor: la lista no se reordena al añadir (${before} cartas)`)

console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'sin errores de página')
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close(); process.exit(failed ? 1 : 0)

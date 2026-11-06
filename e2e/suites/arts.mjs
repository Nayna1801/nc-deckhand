import { chromium } from 'playwright'
import { BASE } from '../config.mjs'
import { newSession } from '../lib/mock.mjs'
import { pick, results, until } from '../lib/helpers.mjs'
import { ALTS } from '../lib/data.mjs'

let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const browser = await chromium.launch()
const ID = 'adam_smasher_ender_of_legends'
const RETAIL_ALT = 'alt:welcometonightcityretail_141'
const BETA_ALT = 'alt:welcometonightcitybeta_141'
const RETAIL = 'Welcome to Night City — Retail'
const BETA = 'Welcome to Night City — Beta'

const tile = (p, num) => p.locator('.tile', { has: p.locator(`[aria-label^="Adam Smasher: Ender of Legends"][aria-label$="#${num}"]`) })
const plus = (t) => t.getByRole('button', { name: 'Añadir uno' })
const badge = async (t) => ((await t.locator('.tile-badge').count()) ? (await t.locator('.tile-badge').innerText()).trim() : '')

/* ================= escenario 1: base de datos con la columna arts ================= */
{
  const { page: p, store, errors } = await newSession(browser, { legacy: false })
  await p.goto(BASE); await p.waitForSelector('.tile')
  await pick(p, 'Set', RETAIL)
  await p.locator('input[type=search]').fill('name:"Adam Smasher: Ender"'); await p.waitForTimeout(450)

  const base = tile(p, '001'), alt = tile(p, '141')
  ok((await base.count()) === 1 && (await alt.count()) === 1, 'Welcome to Night City — Retail: Adam Smasher base (#001) y su arte Iconic (#141) son fichas distintas')

  await plus(base).click(); await p.waitForTimeout(400)
  ok((await badge(base)) === '×1' && (await badge(alt)) === '', 'una copia base cuenta solo en la ficha base, no en el arte Iconic')
  ok(store.collection.get(ID)?.quantity === 1 && Object.keys(store.collection.get(ID)?.arts ?? {}).length === 0, 'se guarda como copia Normal, sin artes')

  await plus(alt).click(); await p.waitForTimeout(400)
  ok((await badge(alt)) === '×1' && (await badge(base)) === '×1', 'el arte Iconic tiene su propio contador')
  const row = store.collection.get(ID)
  ok(row.quantity === 1 && JSON.stringify(row.arts) === JSON.stringify({ [RETAIL_ALT]: 1 }), `en la base de datos: Normal 1 y arts ${JSON.stringify(row.arts)}`)

  // la edición Beta es otro diseño distinto: contador aparte
  await pick(p, 'Set', ''); await pick(p, 'Set', BETA)
  const beta = tile(p, 'β141')
  ok((await beta.count()) === 1 && (await badge(beta)) === '', 'el Iconic de la edición Beta es otro arte y no cuenta como el de Retail')
  await plus(beta).click(); await plus(beta).click(); await p.waitForTimeout(400)
  ok(JSON.stringify(store.collection.get(ID).arts) === JSON.stringify({ [RETAIL_ALT]: 1, [BETA_ALT]: 2 }), `Beta ×2 guardado aparte (${JSON.stringify(store.collection.get(ID).arts)})`)

  // detalle: lista de artes con sus contadores
  await beta.locator('.tile-art').click()
  const modal = p.locator('.modal'); await modal.waitFor()
  const artRows = modal.locator('.art-row')
  ok((await artRows.count()) >= 3, `el detalle lista los artes contables de la carta (${await artRows.count()})`)
  ok((await artRows.filter({ hasText: /β141/ }).locator('.stepper-n').innerText()).trim() === '2', 'el contador del arte Beta marca 2')
  const other = artRows.filter({ hasText: /Alt Art 008/ })
  await other.getByRole('button', { name: 'Añadir uno' }).click(); await p.waitForTimeout(400)
  ok(store.collection.get(ID).arts['alt:prm01_008'] === 1, 'se puede anotar el promo desde el detalle')
  ok(/playset: 1 de 1/i.test(await modal.innerText()) && /sobran 4/i.test(await modal.innerText()), 'las copias de arte cuentan en el total (playset 1 de 1, sobran 4 de las 5 copias)')
  await p.keyboard.press('Escape')

  // por carta: el total suma todo
  await pick(p, 'Set', '')
  await p.getByRole('button', { name: 'Por carta' }).click()
  await p.locator('input[type=search]').fill('name:"Adam Smasher: Ender"'); await p.waitForTimeout(450)
  ok(/×5/.test(await badge(p.locator('.tile').first())), 'por carta, el total es 5 (1 base + 4 en artes)')

  // solo artes + las que tengo
  await p.locator('input[type=search]').fill(''); await p.waitForTimeout(450)
  await p.getByRole('button', { name: 'Por impresión' }).click()
  await p.getByRole('checkbox', { name: /Solo artes alternativos/ }).check()
  const nArts = await results(p)
  ok(nArts === ALTS, `«Solo artes alternativos»: ${nArts} fichas, una por cada arte contable (sin el diseño base)`)
  await pick(p, 'Colección', 'owned')
  ok((await results(p)) === 3, 'artes alternativos que tengo: 3 (Iconic Retail, Iconic Beta y el promo)')
  await pick(p, 'Colección', 'missing')
  ok((await results(p)) === nArts - 3, 'los que me faltan: el resto')
  await pick(p, 'Colección', 'all')

  // colección: estadística y enlace
  await p.goto(BASE + '#/collection'); await p.waitForSelector('.stats-row')
  const stat = p.locator('.stat', { hasText: 'artes alternativos' })
  ok(/^3\s*\/\s*\d+/.test((await stat.locator('strong').innerText()).replace(/\s+/g, ' ').trim()) && /4 copias/i.test(await stat.innerText()), `Colección: 3 artes distintos y 4 copias ("${(await stat.innerText()).replace(/\s+/g, ' ')}")`)
  await stat.click()
  await p.waitForSelector('.tile')
  ok((await until(() => results(p), 3)) === 3 && (await p.getByRole('checkbox', { name: /Solo artes alternativos/ }).isChecked()), 'el enlace de la estadística lista solo esos 3 artes')

  // recarga: persiste
  await p.reload(); await p.waitForSelector('.tile')
  ok((await until(() => results(p), 3)) === 3, 'tras recargar siguen los 3 artes')

  // sin el bulk-bar roto: la retirada de bulk no toca los artes mientras haya copias base
  await p.goto(BASE + '#/collection'); await p.waitForSelector('.stats-row')
  await p.getByRole('tab', { name: /Bulk/ }).click()
  p.on('dialog', (d) => d.accept())
  const adamRow = p.locator('.panel .deck-row', { hasText: 'Adam Smasher: Ender of Legends' })
  for (let i = 0; i < 3; i++) await adamRow.getByRole('button', { name: 'Quitar uno' }).click()
  await adamRow.getByRole('button', { name: /^Retirar Adam/ }).click(); await p.waitForTimeout(500)
  const after = store.collection.get(ID)
  ok(after.quantity === 0 && Object.values(after.arts).reduce((a, b) => a + b, 0) === 4, `retirar 1 copia del bulk quita la base primero y deja los artes (${after.quantity} + ${JSON.stringify(after.arts)})`)
  await adamRow.getByRole('button', { name: /^Retirar Adam/ }).click(); await p.waitForTimeout(500)
  const rest = store.collection.get(ID)
  ok(Object.values(rest.arts).reduce((a, b) => a + b, 0) === 3, 'si ya no quedan copias base, la retirada pasa a los artes (el playset de 1 se respeta)')
  ok(errors.length === 0, 'sin errores de página' + (errors.length ? ': ' + errors.join(' | ') : ''))
}

/* ================= escenario 2: base de datos SIN la columna arts ================= */
{
  const { page: p, store, errors } = await newSession(browser, { legacy: false, noArts: true })
  await p.goto(BASE); await p.waitForSelector('.tile')
  await pick(p, 'Set', RETAIL)
  await p.locator('input[type=search]').fill('name:"Adam Smasher: Ender"'); await p.waitForTimeout(450)
  const base = tile(p, '001'), alt = tile(p, '141')
  await plus(base).click(); await p.waitForTimeout(400)
  ok((await badge(base)) === '×1' && store.collection.get(ID)?.quantity === 1, 'sin la columna, las copias base siguen funcionando')
  ok(await alt.getByRole('button', { name: 'Añadir uno' }).isDisabled(), 'el contador de arte queda desactivado (no se podría guardar)')
  ok(!store.writes.some((w) => w.rows.some((r) => 'arts' in r)), 'no se envía la columna arts al servidor')
  await base.locator('.tile-art').click()
  const modal = p.locator('.modal'); await modal.waitFor()
  ok(/schema\.sql/.test(await modal.innerText()), 'el detalle avisa de que hay que actualizar schema.sql')
  ok(errors.length === 0, 'sin errores de página (sin columna)' + (errors.length ? ': ' + errors.join(' | ') : ''))
}

/* ================= escenario 3: base de datos antigua (sin Foil/Promo ni arts) ================= */
{
  const { page: p, store } = await newSession(browser, { legacy: true })
  await p.goto(BASE); await p.waitForSelector('.tile')
  await p.locator('.tile').first().getByRole('button', { name: 'Añadir uno' }).click(); await p.waitForTimeout(400)
  const w = store.writes.find((x) => x.table === 'tcg_collection')
  ok(!!w && !('arts' in w.rows[0]) && !('qty_foil' in w.rows[0]) && w.rows[0].quantity === 1, 'con la base antigua solo se escribe quantity')
}

console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close(); process.exit(failed ? 1 : 0)

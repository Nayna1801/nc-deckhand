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

  // retirar del bulk: con varias versiones o artes se elige cuáles en un desplegable (sin mensaje de «orden de retirada»)
  await p.goto(BASE + '#/collection'); await p.waitForSelector('.stats-row')
  await p.getByRole('tab', { name: /Bulk/ }).click()
  let dialogs = 0
  p.on('dialog', (d) => { dialogs++; d.accept() })
  const adamLi = p.locator('.bulk-row', { hasText: 'Adam Smasher: Ender of Legends' })
  ok((await adamLi.count()) === 1 && (await adamLi.getByRole('button', { name: /^Retirar Adam/ }).count()) === 0, 'una carta con varias versiones/artes no ofrece «Retirar» por orden: ofrece elegir qué retirar')
  const pickBox = adamLi.locator('details.bulk-pick')
  ok(/elegir qué retirar/i.test(await pickBox.locator('summary').innerText()), 'hay un desplegable «Elegir qué retirar»')
  await pickBox.locator('summary').click()
  const kinds = pickBox.locator('.art-row')
  ok((await kinds.count()) === 4, `lista lo que tienes de la carta: Normal y 3 artes (${await kinds.count()})`)
  ok(/normal/i.test(await kinds.nth(0).innerText()) && /tienes 1/i.test(await kinds.nth(0).innerText()), 'primero el diseño base, con las copias que tienes')
  ok((await pickBox.getByRole('button', { name: /^Retirar lo elegido/ }).isDisabled()), 'sin elegir nada, «Retirar lo elegido» está desactivado')
  // elegir una copia de cada tipo: son 4 = todo el bulk; ya no deja añadir más
  for (let i = 0; i < 4; i++) await kinds.nth(i).getByRole('button', { name: 'Añadir uno' }).click()
  ok(/\(4\)/.test(await pickBox.getByRole('button', { name: /^Retirar lo elegido/ }).innerText()), 'con 4 elegidas el botón dice (4)')
  ok(await kinds.filter({ hasText: /β141/ }).getByRole('button', { name: 'Añadir uno' }).isDisabled(), 'no deja elegir más copias de las que sobran del playset')
  // dejar solo las dos del Iconic Beta
  for (const i of [0, 1, 3]) await kinds.nth(i).getByRole('button', { name: 'Quitar uno' }).click() // fuera Normal, promo y Retail
  await kinds.filter({ hasText: /β141/ }).getByRole('button', { name: 'Añadir uno' }).click()
  ok(/2× .*β141/.test(await pickBox.innerText()), `el resumen indica qué se retira (${(await pickBox.locator('.bulk-pick-foot').innerText()).replace(/\s+/g, ' ')})`)
  await pickBox.getByRole('button', { name: /^Retirar lo elegido/ }).click(); await p.waitForTimeout(500)
  const afterPick = store.collection.get(ID)
  ok(afterPick.quantity === 1 && JSON.stringify(afterPick.arts) === JSON.stringify({ [RETAIL_ALT]: 1, 'alt:prm01_008': 1 }), `retira solo las 2 del Iconic Beta y deja la base y los demás artes (${afterPick.quantity} + ${JSON.stringify(afterPick.arts)})`)
  ok(dialogs === 0, 'sin ningún cuadro de confirmación del navegador al retirar lo elegido')
  // ahora quedan 3 copias (bulk 2): base + promo
  const kinds2 = adamLi.locator('details.bulk-pick .art-row')
  if (!(await adamLi.locator('details.bulk-pick').evaluate((el) => el.open))) await adamLi.locator('details.bulk-pick summary').click()
  ok(await adamLi.locator('details.bulk-pick').evaluate((el) => el.open), 'el desplegable sigue abierto tras retirar, para poder seguir eligiendo')
  await kinds2.nth(0).getByRole('button', { name: 'Añadir uno' }).click()
  await kinds2.filter({ hasText: /Alt Art 008/ }).getByRole('button', { name: 'Añadir uno' }).click()
  await adamLi.getByRole('button', { name: /^Retirar lo elegido/ }).click(); await p.waitForTimeout(500)
  const rest = store.collection.get(ID)
  ok(rest.quantity === 0 && JSON.stringify(rest.arts) === JSON.stringify({ [RETAIL_ALT]: 1 }), `se puede retirar base y un arte a la vez; queda el playset de 1 (${rest.quantity} + ${JSON.stringify(rest.arts)})`)
  ok((await p.locator('.bulk-row', { hasText: 'Adam Smasher' }).count()) === 0, 'la carta sale del bulk al quedarse en su playset')
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

/* ================= escenario 4: copias «Promo» anotadas antes de poder elegir el arte ================= */
{
  const { page: p, store, errors } = await newSession(browser, { legacy: false })
  store.collection.set(ID, { card_id: ID, quantity: 1, qty_foil: 0, qty_promo: 2, condition: 'mint', arts: {} })
  store.collection.set('saul_bright_stormrider', { card_id: 'saul_bright_stormrider', quantity: 2, qty_foil: 0, qty_promo: 0, condition: 'mint', arts: {} })
  await p.goto(BASE); await p.waitForSelector('.tile')
  await p.locator('input[type=search]').fill('name:"Adam Smasher: Ender"'); await p.waitForTimeout(450)
  await p.locator('.tile-art').first().click()
  const modal = p.locator('.modal'); await modal.waitFor()
  const legacy = modal.locator('.legacy-promo')
  ok((await legacy.count()) === 1 && /sin arte concreto/i.test(await legacy.innerText()), 'con copias Promo antiguas se muestra la fila «Promo (sin arte concreto)»')
  ok((await legacy.locator('.stepper-n').innerText()).trim() === '2', 'con sus 2 copias')
  const totalBefore = /playset: 1 de 1/i.test(await modal.innerText()) && /sobran 2/i.test(await modal.innerText())
  ok(totalBefore, 'el total es 3 copias (1 Normal + 2 Promo): playset 1 de 1 y sobran 2')
  await legacy.locator('select').selectOption({ index: 1 })
  await p.waitForTimeout(400)
  const moved = store.collection.get(ID)
  ok(moved.qty_promo === 1 && Object.values(moved.arts).join() === '1' && moved.quantity === 1, `pasar una copia a un arte la quita de Promo y la anota en el arte (${JSON.stringify({ promo: moved.qty_promo, arts: moved.arts })})`)
  ok(/sobran 2/i.test(await modal.innerText()), 'el total de la carta no cambia al repartir las copias')
  await legacy.locator('select').selectOption({ index: 1 })
  await p.waitForTimeout(400)
  ok(store.collection.get(ID).qty_promo === 0 && (await modal.locator('.legacy-promo').count()) === 0, 'al repartir la última copia, la fila de Promo antiguo desaparece')
  await p.keyboard.press('Escape')
  // una carta sin copias Promo antiguas no muestra esa fila
  await p.locator('input[type=search]').fill('name:"Saul Bright"'); await p.waitForTimeout(450)
  await p.locator('.tile-art').first().click()
  await modal.waitFor()
  ok((await modal.locator('.legacy-promo').count()) === 0, 'sin copias Promo antiguas no aparece esa fila')
  ok(errors.length === 0, 'sin errores de página (promo antiguo)' + (errors.length ? ': ' + errors.join(' | ') : ''))
}

/* ================= escenario 5: retirar varias cartas a la vez con una de ellas con varias versiones ================= */
{
  const { page: p, store, errors } = await newSession(browser, { legacy: false })
  store.collection.set(ID, { card_id: ID, quantity: 1, qty_foil: 0, qty_promo: 0, condition: 'mint', arts: { 'alt:prm01_008': 1, [BETA_ALT]: 1 } }) // total 3, bulk 2
  store.collection.set('saul_bright_stormrider', { card_id: 'saul_bright_stormrider', quantity: 4, qty_foil: 0, qty_promo: 0, condition: 'mint', arts: {} }) // bulk 1
  const messages = []
  p.on('dialog', (d) => { messages.push(d.message()); d.accept() })
  await p.goto(BASE + '#/collection'); await p.waitForSelector('.stats-row')
  await p.getByRole('tab', { name: /Bulk/ }).click()
  await p.getByRole('button', { name: 'Seleccionar todo' }).click()
  const batch = p.getByRole('button', { name: /^Retirar seleccionadas/ })
  ok(/\(1\)/.test(await batch.innerText()), `«Retirar seleccionadas» cuenta solo lo que ya está decidido: la carta de una sola versión (${(await batch.innerText()).trim()})`)
  await batch.click(); await p.waitForTimeout(500)
  ok(messages.length === 1 && /Se omiten.*Adam Smasher/.test(messages[0]) && !/primero las Normales/.test(messages[0]), `avisa de qué carta se omite y ya no habla de «orden de retirada» (${messages[0]?.replace(/\n/g, ' / ')})`)
  ok(store.collection.get('saul_bright_stormrider').quantity === 3, 'se retira la de una sola versión')
  ok(store.collection.get(ID).quantity === 1 && Object.keys(store.collection.get(ID).arts).length === 2, 'y la de varias versiones no se toca hasta que elijas qué retirar')
  // con una elección hecha, la retirada múltiple la incluye
  const adamLi = p.locator('.bulk-row', { hasText: 'Adam Smasher: Ender of Legends' })
  await adamLi.locator('details.bulk-pick summary').click()
  await adamLi.locator('.art-row', { hasText: /β141/ }).getByRole('button', { name: 'Añadir uno' }).click()
  await adamLi.getByRole('checkbox').check()
  const batch2 = p.getByRole('button', { name: /^Retirar seleccionadas/ })
  ok(/\(1\)/.test(await batch2.innerText()), 'con una copia elegida, «Retirar seleccionadas» la cuenta')
  messages.length = 0
  await batch2.click(); await p.waitForTimeout(500)
  ok(messages.length === 1 && !/Se omiten/.test(messages[0]), 'ya no se omite ninguna')
  ok(JSON.stringify(store.collection.get(ID).arts) === JSON.stringify({ 'alt:prm01_008': 1 }) && store.collection.get(ID).quantity === 1, 'se retira exactamente la copia elegida (el Iconic Beta)')
  ok(errors.length === 0, 'sin errores de página (retirada múltiple)' + (errors.length ? ': ' + errors.join(' | ') : ''))
}

console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close(); process.exit(failed ? 1 : 0)

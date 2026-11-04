import { chromium } from 'playwright'
import { BASE } from '../config.mjs'
import { newBackend } from '../lib/backend.mjs'

let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }
const seq = (a) => a.join(' → ')

const browser = await chromium.launch()
console.log('Probando contra:', BASE)

async function session(opts) {
  const b = await newBackend(browser, opts)
  await b.page.goto(BASE); await b.page.waitForSelector('.tile'); await b.settle()
  return b
}
const find = async (p, name) => { await p.locator('input[type=search]').fill(`name:"${name}"`); await p.waitForTimeout(450); return p.locator('.tile').first() }
const val = async (t) => parseInt((await t.locator('.stepper-n').innerText()).trim(), 10)
const plus = (t) => t.getByRole('button', { name: 'Añadir uno' })
const minus = (t) => t.getByRole('button', { name: 'Quitar uno' })
const total = (r) => (r ? r.quantity + r.qty_foil + r.qty_promo : 0)

/* ---- S1/S2/S3: clics rápidos desde cero ---- */
{
  const { page: p, store, settle } = await session({})
  const t = await find(p, 'Saul Bright: Stormrider')
  const ups = []
  for (let i = 0; i < 6; i++) { await plus(t).click(); ups.push(await val(t)) }
  ok(JSON.stringify(ups) === '[1,2,3,4,5,6]', `+ rápido x6 sube de 1 en 1: ${seq(ups)}`)
  await settle()
  ok(total(store.collection.get('saul_bright_stormrider')) === 6, `y la base de datos queda en 6 (real: ${total(store.collection.get('saul_bright_stormrider'))})`)
  const downs = []
  for (let i = 0; i < 4; i++) { await minus(t).click(); downs.push(await val(t)) }
  ok(JSON.stringify(downs) === '[5,4,3,2]', `− rápido x4 baja de 1 en 1: ${seq(downs)}`)
  await settle()
  ok(total(store.collection.get('saul_bright_stormrider')) === 2, `base de datos en 2 (real: ${total(store.collection.get('saul_bright_stormrider'))})`)
  await plus(t).dblclick(); await settle()
  ok((await val(t)) === 4, `doble clic en + suma exactamente 2 (de 2 a ${await val(t)})`)
  await minus(t).dblclick(); await settle()
  ok((await val(t)) === 2, `doble clic en − resta exactamente 2 (de 4 a ${await val(t)})`)
  const alt = []
  for (const f of [plus, minus, plus, minus, plus]) { await f(t).click(); alt.push(await val(t)) }
  ok(JSON.stringify(alt) === '[3,2,3,2,3]', `alternar + − + − +: ${seq(alt)}`)
  await settle()
  ok(total(store.collection.get('saul_bright_stormrider')) === 3 && (await val(t)) === 3, 'tras alternar, interfaz y base de datos coinciden (3)')
  await p.reload(); await p.waitForSelector('.tile'); await settle()
  const t2 = await find(p, 'Saul Bright: Stormrider')
  ok((await val(t2)) === 3, `tras recargar sigue en 3 (real: ${await val(t2)})`)
}

/* ---- S4/S5/S6: datos ya existentes con versiones mezcladas ---- */
{
  const { page: p, store, settle } = await session({
    rows: {
      dexter_deshawn_off_the_grid: { quantity: 2, qty_promo: 1, qty_foil: 1 },
      ruthless_lowlife: { quantity: 0, qty_promo: 1, qty_foil: 0 },
      kiroshi_optics: { quantity: 3, qty_foil: 1 },
    },
  })
  let t = await find(p, 'Dexter DeShawn: Off the Grid')
  ok((await val(t)) === 4, `carga el total real (2 Normal + 1 Promo + 1 Foil = ${await val(t)})`)
  const d = []
  for (let i = 0; i < 4; i++) { await minus(t).click(); d.push(await val(t)) }
  ok(JSON.stringify(d) === '[3,2,1,0]', `− x4 con versiones mezcladas baja siempre 1: ${seq(d)}`)
  await settle()
  ok(!store.collection.has('dexter_deshawn_off_the_grid'), 'al llegar a 0 la fila se borra de la base de datos')
  t = await find(p, 'Ruthless Lowlife')
  ok((await val(t)) === 1, 'carta con SOLO 1 Promo muestra 1')
  await minus(t).click(); await settle()
  ok((await val(t)) === 0 && !store.collection.has('ruthless_lowlife'), 'su − la quita (antes no hacía nada)')
  t = await find(p, 'Kiroshi Optics')
  ok((await val(t)) === 4, 'carta con 3 Normal + 1 Foil muestra 4')
  await plus(t).click(); await settle()
  const r = store.collection.get('kiroshi_optics')
  ok((await val(t)) === 5 && r.quantity === 4 && r.qty_foil === 1, `+ suma una Normal (5 en total; Normal ${r.quantity}, Foil ${r.qty_foil})`)
  await p.reload(); await p.waitForSelector('.tile'); await settle()
  t = await find(p, 'Kiroshi Optics')
  ok((await val(t)) === 5, 'tras recargar sigue en 5')
  ok(store.violations.length === 0, 'ninguna escritura rompe las restricciones de la base de datos')
}

/* ---- S8: vista lista ---- */
{
  const { page: p, store, settle } = await session({})
  await p.getByRole('button', { name: /Lista/ }).click()
  await p.locator('input[type=search]').fill('name:"Floor It"'); await p.waitForTimeout(450)
  const row = p.locator('.crow').first()
  const v = async () => parseInt((await row.locator('.stepper-n').innerText()).trim(), 10)
  const u = []; for (let i = 0; i < 4; i++) { await row.getByRole('button', { name: 'Añadir uno' }).click(); u.push(await v()) }
  const w = []; for (let i = 0; i < 3; i++) { await row.getByRole('button', { name: 'Quitar uno' }).click(); w.push(await v()) }
  ok(JSON.stringify(u) === '[1,2,3,4]' && JSON.stringify(w) === '[3,2,1]', `vista lista: + ${seq(u)} | − ${seq(w)}`)
  await settle()
  ok(total(store.collection.get('floor_it')) === 1, 'vista lista: base de datos coherente (1)')
}

/* ---- S9: clic mientras todavía cargan tus datos (conexión lenta) ---- */
{
  const bk = await newBackend(browser, { rows: { saul_bright_stormrider: { quantity: 3 } }, getLatency: 1800 })
  const p = bk.page, store = bk.store
  await p.goto(BASE); await p.waitForSelector('.tile')
  const t = await find(p, 'Saul Bright: Stormrider')
  const duringLoad = { plus: await plus(t).isEnabled(), minus: await minus(t).isEnabled(), heart: await t.locator('.heart').isDisabled().catch(() => null) }
  console.log(`   (mientras cargan los datos: + habilitado=${duringLoad.plus}, - habilitado=${duringLoad.minus}, corazón deshabilitado=${duringLoad.heart})`)
  ok(!duringLoad.plus && !duringLoad.minus, 'mientras cargan tus datos los botones + y − están bloqueados')
  ok(/cargando/i.test((await t.locator('.stepper').getAttribute('title')) || ''), 'y avisan con la pista "Cargando tus datos…"')
  await plus(t).click({ force: true, timeout: 1500 }).catch(() => {})
  await p.waitForFunction(() => !document.querySelector('.stepper[title*="Cargando"]'), null, { timeout: 8000 })
  await bk.settle()
  const t2 = await find(p, 'Saul Bright: Stormrider')
  ok((await val(t2)) === 3 && total(store.collection.get('saul_bright_stormrider')) === 3, `al terminar de cargar muestra las 3 copias reales y el servidor conserva las 3 (interfaz ${await val(t2)}, servidor ${total(store.collection.get('saul_bright_stormrider'))})`)
  ok(await plus(t2).isEnabled(), 'los botones se activan cuando los datos han cargado')
  await plus(t2).click(); await bk.settle()
  ok((await val(t2)) === 4 && total(store.collection.get('saul_bright_stormrider')) === 4, 'y entonces el + suma 1 (4)')
}

/* ---- S10: modal y tarjeta se mantienen coherentes ---- */
{
  const { page: p, store, settle } = await session({})
  const t = await find(p, 'Placide: Voodoo Sentinel')
  await t.locator('.tile-art').click(); await p.locator('.modal').waitFor()
  const add = (label) => p.locator('.modal .inventory .row', { hasText: label }).getByRole('button', { name: 'Añadir uno' })
  for (let i = 0; i < 3; i++) await add('Normal').click()
  await settle()
  ok(total(store.collection.get('placide_voodoo_sentinel')) === 3, 'modal: 3 clics rápidos en Normal = 3 copias')
  await p.keyboard.press('Escape')
  ok((await val(t)) === 3, 'la tarjeta refleja las 3 al cerrar el modal')
  await minus(t).click(); await settle()
  ok((await val(t)) === 2 && total(store.collection.get('placide_voodoo_sentinel')) === 2, 'y su − resta 1 (2 copias)')
}

/* ---- S11: constructor de mazos ---- */
{
  const { page: p, store, settle } = await session({})
  await p.goto(BASE + '#/decks'); await p.getByRole('button', { name: 'Nuevo mazo' }).click(); await p.waitForURL(/#\/decks\/.+/)
  await p.locator('input[type=search]').fill('name:"Saul Bright: Stormrider"'); await p.waitForTimeout(450)
  const addBtn = p.getByRole('button', { name: 'Añadir Saul Bright: Stormrider' })
  const counts = async () => (await p.locator('.counters').innerText()).match(/Mazo (\d+)/)[1]
  const a = []; for (let i = 0; i < 4; i++) { if (await addBtn.isEnabled()) await addBtn.click(); a.push(await counts()) }
  ok(JSON.stringify(a) === '["1","2","3","3"]', `constructor: + hasta el tope de 3 copias: ${seq(a)}`)
  const row = p.locator('ul.zone').first().locator('.deck-row').first()
  const m = []; for (let i = 0; i < 2; i++) { await row.getByRole('button', { name: 'Quitar uno' }).click(); m.push(await counts()) }
  ok(JSON.stringify(m) === '["2","1"]', `constructor: − en la fila resta de 1 en 1: ${seq(m)}`)
  await row.getByRole('button', { name: 'Añadir uno' }).dblclick()
  ok((await counts()) === '3', `constructor: doble clic en + de la fila suma 2 (llega a ${await counts()}, tope 3)`)
  await settle()
}

console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close(); process.exit(failed ? 1 : 0)

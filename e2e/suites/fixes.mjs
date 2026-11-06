import { chromium } from 'playwright'
import { BASE, CARDS, SHOTS } from '../config.mjs'
import fs from 'node:fs'
import { newSession } from '../lib/mock.mjs'

const shots = SHOTS
const cards = CARDS
let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }
const PROMO = /promo|judge|topper/i
const plain = cards.find((c) => c.type === 'Unit' && c.altArts.length === 0 && !c.printings.some((p) => PROMO.test(p.baseSetName)))
const withAlt = cards.find((c) => c.type === 'Unit' && c.altArts.length > 0)
const legend = cards.find((c) => c.id === 'adam_smasher_ender_of_legends')

const browser = await chromium.launch()
const s = await newSession(browser, { legacy: false })
const p = s.page
await p.setViewportSize({ width: 390, height: 700 }) // móvil: el modal tiene scroll
const row = (id) => s.store.collection.get(id)
const openCard = async (c) => {
  const search = p.locator('input[type=search]')
  await search.fill(`name:"${c.displayName}"`); await p.waitForTimeout(450)
  await p.locator('.tile-art').first().click()
  await p.locator('.modal').waitFor()
  // se mide con la imagen ya cargada: si no, al llegar empuja el contenido y falsea la medida
  await p.waitForFunction(() => document.querySelector('.modal-img')?.complete === true)
}
const closeModal = async () => { await p.keyboard.press('Escape'); await p.locator('.modal').waitFor({ state: 'detached' }) }
const addIn = (label) => p.locator('.modal .inventory .row', { hasText: label }).getByRole('button', { name: 'Añadir uno' })

await p.goto(BASE); await p.waitForSelector('.tile')

/* ---------- 1. el modal no salta arriba al pulsar + ---------- */
await openCard(withAlt)
const info = await p.evaluate(() => { const m = document.querySelector('.modal-scroll'); return { sh: m.scrollHeight, ch: m.clientHeight } })
ok(info.sh > info.ch + 150, `(el modal tiene scroll en esta pantalla: ${info.sh}px de contenido en ${info.ch}px)`)
// el hueco de la imagen está reservado: la altura del contenido no cambia al cargar
const h0 = await p.locator('.modal-scroll').evaluate((m) => m.scrollHeight)
await p.waitForTimeout(400)
ok((await p.locator('.modal-scroll').evaluate((m) => m.scrollHeight)) === h0, 'la altura del detalle no cambia después de abrirse (la imagen reserva su espacio)')
await p.locator('.modal-scroll').evaluate((m) => (m.scrollTop = 220))
// Playwright desplaza el botón a la vista antes de pulsar: se hace ANTES de medir, para medir solo lo que haga la app
await addIn('Normal').scrollIntoViewIfNeeded()
const before = await p.locator('.modal-scroll').evaluate((m) => m.scrollTop)
for (let i = 0; i < 3; i++) { await addIn('Normal').click(); await p.waitForTimeout(150) }
const after = await p.locator('.modal-scroll').evaluate((m) => m.scrollTop)
ok(before > 100 && Math.abs(after - before) <= 4, `el scroll se mantiene al pulsar + tres veces (antes ${Math.round(before)}px, después ${Math.round(after)}px)`)
ok(!(await p.evaluate(() => document.activeElement?.classList.contains('modal-x'))), 'el foco no vuelve al botón ✕ de arriba')
ok(row(withAlt.id)?.quantity === 3, 'y las 3 copias se guardaron')
await p.screenshot({ path: shots + '/g1-modal-scroll.png' })
// el foco sigue atrapado dentro del modal (accesibilidad intacta)
await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Shift+Tab')
ok(await p.evaluate(() => !!document.activeElement?.closest('.modal')), 'el foco sigue dentro del modal con el teclado')
await closeModal()
ok(await p.evaluate(() => !document.querySelector('.modal')), 'Escape cierra el modal')

/* ---------- 2. playset de Legends = 1 ---------- */
await openCard(legend)
let t = await p.locator('.modal').innerText()
ok(/playset: 0 de 1 copia\b/i.test(t) && !/0 de 3/i.test(t), 'Legend sin copias: "Playset: 0 de 1 copia" (no 0 de 3)')
ok(/se lleva una sola vez por mazo/i.test(t), 'explica por qué: una Legend se lleva una sola vez por mazo')
await addIn('Normal').click(); await p.waitForTimeout(250)
t = await p.locator('.modal').innerText()
ok(/playset: 1 de 1 copia\b/i.test(t) && /tienes el playset completo/i.test(t) && !/sobra/i.test(t), 'con 1 copia el playset de la Legend está completo')
await addIn('Normal').click(); await p.waitForTimeout(250)
t = await p.locator('.modal').innerText()
ok(/sobra 1 copia/i.test(t) && /sobran 1 \(bulk\)/i.test(t), 'la 2ª copia de una Legend ya cuenta como sobrante (bulk)')
await closeModal()
await openCard(plain)
t = await p.locator('.modal').innerText()
ok(/playset: 0 de 3 copias/i.test(t), 'una carta normal sigue siendo "0 de 3 copias"')

/* ---------- 3 y 4. solo se ofrecen las versiones que existen ---------- */
const rows = async () => (await p.locator('.modal .inventory .row strong').allInnerTexts()).map((x) => x.trim())
let r = await rows()
ok(JSON.stringify(r) === JSON.stringify(['Normal']) && /solo existe en versión normal/i.test(await p.locator('.modal').innerText()), `carta sin variantes ("${plain.displayName}"): solo "Normal" y la nota lo explica`)
await p.getByRole('button', { name: /Mostrar/ }).click()
r = await rows()
ok(r.includes('Normal') && r.includes('Foil') && !r.some((x) => /promo/i.test(x)), '"¿Tienes una versión Foil? Mostrar" despliega Foil (ya no hay fila de Promo: cada arte tiene el suyo)')
await closeModal()
await openCard(withAlt)
r = await rows()
ok(r.includes('Normal') && !r.includes('Foil') && !r.some((x) => /promo/i.test(x)), `carta con artes alternativos ("${withAlt.displayName}"): solo Normal en las filas de versión; los artes van en su propia lista`)
ok((await p.locator('.modal .art-row').count()) === withAlt.altArts.length, 'y la lista de artes tiene uno por cada arte alternativo')
await closeModal()

/* ---------- 5. el − de la carta resta del total, no solo de las Normales ---------- */
// carta sin variantes: 1 Normal + 1 Foil (anotada con "Mostrar todas")
await openCard(plain)
await p.getByRole('button', { name: /Mostrar/ }).click()
await addIn('Normal').click(); await p.waitForTimeout(200)
await addIn('Foil').click(); await p.waitForTimeout(250)
ok(row(plain.id)?.quantity === 1 && row(plain.id)?.qty_foil === 1, '(preparado: 1 Normal + 1 Foil)')
await closeModal()
await openCard(plain)
r = await rows()
ok(r.includes('Foil'), 'si ya tienes anotado un Foil, la fila de Foil sigue visible aunque el catálogo no lo tenga')
await closeModal()
await p.locator('input[type=search]').fill(`name:"${plain.displayName}"`); await p.waitForTimeout(450)
const tile = p.locator('.tile').first()
ok(/×2/.test(await tile.locator('.tile-badge').innerText()) && (await tile.locator('.stepper-n').innerText()).trim() === '2', 'la carta muestra el total (2) en insignia y stepper')
await tile.getByRole('button', { name: 'Quitar uno' }).click(); await p.waitForTimeout(250)
ok(row(plain.id)?.quantity === 0 && row(plain.id)?.qty_foil === 1, 'el − quita primero la Normal (queda 1 Foil)')
await tile.getByRole('button', { name: 'Quitar uno' }).click(); await p.waitForTimeout(250)
ok(!row(plain.id), 'el − siguiente quita el Foil: ya no hay ninguna copia (antes no hacía nada)')
await tile.getByRole('button', { name: 'Añadir uno' }).click(); await p.waitForTimeout(250)
ok(row(plain.id)?.quantity === 1 && !(row(plain.id)?.qty_foil), 'el + añade una copia Normal')
// solo copias no normales (el caso exacto que se quejaba)
await tile.getByRole('button', { name: 'Quitar uno' }).click(); await p.waitForTimeout(250)
await p.locator('.tile-art').first().click(); await p.locator('.modal').waitFor()
await p.getByRole('button', { name: /Mostrar/ }).click()
await addIn('Foil').click(); await p.waitForTimeout(250)
await closeModal()
ok((await tile.locator('.stepper-n').innerText()).trim() === '1' && row(plain.id)?.quantity === 0 && row(plain.id)?.qty_foil === 1, '(preparado: solo 1 Foil, 0 Normales)')
await tile.getByRole('button', { name: 'Quitar uno' }).click(); await p.waitForTimeout(250)
ok(!row(plain.id), 'con solo un Foil, el − de la carta sí lo quita')

/* ---------- Colección: playset y bulk con Legends ---------- */
await p.goto(BASE + '#/collection'); await p.waitForSelector('.stats-row')
const stats = (await p.locator('.stats-row').innerText()).replace(/\n/g, ' ')
ok(/1\s*copias en bulk/i.test(stats), 'Colección: 1 copia en bulk (la 2ª Legend) y no más')
ok(/de playsets completos/i.test(stats), 'Colección: el porcentaje habla de "playsets completos" (3 copias, 1 en Legends)')
await p.getByRole('tab', { name: /Bulk/ }).click()
ok((await p.locator('.panel .deck-row').count()) === 1 && /Adam Smasher/.test(await p.locator('.panel .deck-row').innerText()), 'la pestaña Bulk lista la Legend sobrante')

console.log(s.errors.length ? 'ERRORES: ' + s.errors.join(' | ') : 'sin errores de página')
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close(); process.exit(failed ? 1 : 0)

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { BASE, CARDS, ROOT } from '../config.mjs'
import { newSession } from '../lib/mock.mjs'

let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const browser = await chromium.launch()
const COLOR = { Red: 0, Yellow: 1, Blue: 2, Green: 3 }
const idNum = (c) => parseInt(c.importId ?? '', 10) || 0
const byColorId = (a, b) => (COLOR[a.color] ?? 9) - (COLOR[b.color] ?? 9) || idNum(a) - idNum(b) || (a.importId ?? '').localeCompare(b.importId ?? '') || a.displayName.localeCompare(b.displayName)
const nonLegend = CARDS.filter((c) => c.type !== 'Legend')

const phone = (w = 375) => ({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

async function newDeck(p) {
  await p.goto(BASE + '#/decks'); await p.waitForTimeout(400)
  await p.getByRole('button', { name: 'Nuevo mazo' }).click()
  await p.waitForURL(/#\/decks\/.+/)
  await p.waitForSelector('.editor-cards .tile')
}

/** El catálogo del editor va paginado: para tocar una carta concreta se busca primero por su nombre. */
async function showCard(p, name) {
  await p.locator('.editor-cards input[type=search]').fill(`name:"${name}"`)
  await p.waitForTimeout(450)
}

const overflowX = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

/* ---- + y − en el catálogo (móvil táctil) ---- */
{
  const { page: p, errors } = await newSession(browser, { legacy: false, context: phone() })
  await newDeck(p)
  const name = 'Saul Bright: Stormrider'
  await showCard(p, name)
  const plus = p.getByRole('button', { name: `Añadir ${name}` })
  const minus = p.getByRole('button', { name: `Quitar ${name}` })
  const tile = p.locator('.editor-cards .tile').filter({ has: plus })
  ok(await minus.isVisible(), 'en el catálogo, junto al + hay un botón − (también en el móvil)')
  ok(await minus.isDisabled(), '− está desactivado mientras la carta no está en el mazo')
  const box = await minus.boundingBox()
  ok(box.x >= 0 && box.x + box.width <= 375 && box.height >= 36, `− cabe en la pantalla y se puede pulsar con el dedo (${Math.round(box.width)}×${Math.round(box.height)})`)
  await plus.click(); await plus.click()
  ok((await tile.locator('.stepper-n').innerText()) === '2', '+ dos veces: el mazo lleva 2 copias')
  await minus.click()
  ok((await tile.locator('.stepper-n').innerText()) === '1', '− quita una copia')
  await minus.click()
  ok((await tile.locator('.stepper-n').innerText()) === '0' && (await minus.isDisabled()), '− hasta 0 y vuelve a desactivarse')
  // con la zona «Al sideboard» elegida, − quita de ahí; si no está allí, quita de la otra zona
  await plus.click()
  await p.getByRole('button', { name: 'Al sideboard' }).click()
  await minus.click()
  ok((await tile.locator('.stepper-n').innerText()) === '0', '− quita la copia aunque esté en la otra zona (mazo) y no en la elegida (sideboard)')
  await p.getByRole('button', { name: 'Al mazo' }).click()

  await p.getByRole('button', { name: /Lista/ }).click()
  const row = p.locator('.editor-cards .crow').filter({ has: plus })
  await row.scrollIntoViewIfNeeded()
  await plus.click()
  ok((await row.locator('.stepper-n').innerText()) === '1' && (await row.getByRole('button', { name: `Quitar ${name}` }).isEnabled()), 'en la vista lista también hay + y −')
  ok(errors.length === 0, 'sin errores de página' + (errors.length ? ': ' + errors.join(' | ') : ''))
}

/* ---- la lista del catálogo cabe en el móvil ---- */
for (const W of [320, 375, 768]) {
  const { page: p } = await newSession(browser, { legacy: false, context: phone(W) })
  await newDeck(p)
  await p.getByRole('button', { name: /Lista/ }).click()
  await p.waitForSelector('.crow')
  ok((await overflowX(p)) <= 1, `${W}px · catálogo del constructor en lista: la página no se sale del ancho (${await overflowX(p)}px de más)`)
  const rows = await p.evaluate(() => [...document.querySelectorAll('.editor-cards .crow')].slice(0, 12).map((r) => { const b = r.getBoundingClientRect(); return { r: b.right, h: b.height } }))
  ok(rows.every((r) => r.r <= W + 1), `${W}px · las filas caben en el ancho`)
  if (W <= 375) ok(rows.every((r) => r.h < 190), `${W}px · las filas son compactas (máx. ${Math.round(Math.max(...rows.map((r) => r.h)))}px de alto)`)
  await p.getByRole('button', { name: /Galería/ }).click()
  ok((await overflowX(p)) <= 1, `${W}px · y en galería tampoco`)
}

/* ---- lista del mazo: tipos, color e Id, miniaturas y controles a la derecha ---- */
{
  const { page: p } = await newSession(browser, { legacy: false, context: phone() })
  await newDeck(p)
  const pickOne = (type, color, skip = 0) => nonLegend.filter((c) => c.type === type && c.color === color)[skip]
  const cards = [
    pickOne('Unit', 'Green'), pickOne('Unit', 'Red', 2), pickOne('Unit', 'Blue'), pickOne('Unit', 'Red', 0), pickOne('Unit', 'Yellow'),
    pickOne('Gear', 'Blue'), pickOne('Gear', 'Red'),
    pickOne('Program', 'Green'), pickOne('Program', 'Red'),
  ].filter(Boolean)
  // la carta de nombre más largo, para comprobar que los controles no se van al principio de la línea
  const longest = [...nonLegend].sort((a, b) => b.displayName.length - a.displayName.length).find((c) => !cards.includes(c))
  cards.push(longest)
  for (const c of cards) { await showCard(p, c.displayName); await p.getByRole('button', { name: `Añadir ${c.displayName}` }).click() }
  await p.getByRole('tab', { name: /Mazo/ }).click()
  await p.waitForSelector('.editor-deck .dk-row')
  const heads = (await p.locator('ul.zone').first().locator('.dk-group span').allInnerTexts()).map((t) => t.toLowerCase()) // el CSS los pone en mayúsculas
  const wanted = ['Unit', 'Gear', 'Program'].filter((t) => cards.some((c) => c.type === t))
  const label = { Unit: 'Unidades', Gear: 'Gear', Program: 'Programas' }
  ok(JSON.stringify(heads) === JSON.stringify(wanted.map((t) => label[t].toLowerCase())), `el mazo se divide en ${wanted.map((t) => label[t]).join(', ')} (en ese orden): ${heads.join(', ')}`)
  const counts = await p.locator('ul.zone').first().locator('.dk-group small').allInnerTexts()
  ok(JSON.stringify(counts) === JSON.stringify(wanted.map((t) => String(cards.filter((c) => c.type === t).length))), `cada encabezado cuenta sus copias (${counts.join(', ')})`)

  const rowsText = await p.locator('ul.zone').first().locator('li').evaluateAll((lis) => lis.map((li) => ({ head: li.classList.contains('dk-group'), text: li.innerText.replace(/\s+/g, ' ').trim() })))
  let group = null
  const seen = {}
  for (const r of rowsText) {
    if (r.head) { group = wanted[Object.keys(seen).length]; seen[group] = []; continue }
    const card = cards.find((c) => r.text.includes(c.displayName))
    if (card) seen[group].push(card)
  }
  for (const t of wanted) {
    const expected = cards.filter((c) => c.type === t).sort(byColorId).map((c) => c.displayName)
    ok(JSON.stringify(seen[t].map((c) => c.displayName)) === JSON.stringify(expected), `${label[t]}: ordenadas por color (Red, Yellow, Blue, Green) y por Id`)
  }

  const thumbs = await p.locator('.editor-deck .dk-row .dk-thumb img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('src') ?? ''))
  ok(thumbs.length === cards.length && thumbs.every((s) => /\.webp$/.test(s)), `cada carta del mazo lleva su miniatura (${thumbs.length})`)

  const geo = await p.locator('ul.zone').first().locator('.dk-row').evaluateAll((rs) => rs.map((r) => { const b = r.getBoundingClientRect(); const s = r.querySelector('.stepper').getBoundingClientRect(); const n = r.querySelector('.dk-name').getBoundingClientRect(); return { rowRight: b.right, stepRight: s.right, stepLeft: s.left, nameLeft: n.left, nameRight: n.right } }))
  ok(geo.every((g) => Math.abs(g.rowRight - g.stepRight) <= 2), 'los botones − y + quedan pegados al borde derecho de la fila, sea cual sea la longitud del nombre')
  ok(new Set(geo.map((g) => Math.round(g.stepRight))).size === 1, 'y todos alineados entre sí')
  ok(geo.every((g) => g.stepLeft >= g.nameRight - 1 && g.nameLeft < g.stepLeft), 'el nombre largo se parte en líneas sin pasar por debajo de los botones')
  ok((await overflowX(p)) <= 1, 'la lista del mazo no desborda la pantalla')
}

/* ---- Legends: las tres ranuras miden lo mismo ---- */
{
  const { page: p } = await newSession(browser, { legacy: false, context: phone() })
  await newDeck(p)
  const legends = CARDS.filter((c) => c.type === 'Legend').sort((a, b) => a.displayName.length - b.displayName.length)
  const chosen = []
  for (const l of [legends[0], legends[legends.length - 1], legends[Math.floor(legends.length / 2)]]) if (!chosen.some((c) => c.name === l.name)) chosen.push(l)
  for (const l of chosen) { await showCard(p, l.displayName); await p.getByRole('button', { name: `Añadir ${l.displayName}` }).click() }
  await p.getByRole('tab', { name: /Mazo/ }).click()
  await p.waitForSelector('.slot.filled')
  const g = await p.locator('.slot.filled').evaluateAll((ss) => ss.map((s) => { const b = s.getBoundingClientRect(); const x = s.querySelector('.btn').getBoundingClientRect(); return { h: Math.round(b.height), w: Math.round(b.width), bx: Math.round(x.top), bw: Math.round(x.width) } }))
  ok(g.length === chosen.length && new Set(g.map((s) => s.h)).size === 1, `las ranuras de Legend tienen la misma altura aunque los nombres sean de distinta longitud (${g.map((s) => s.h).join(', ')}px)`)
  ok(new Set(g.map((s) => s.bx)).size === 1 && new Set(g.map((s) => s.bw)).size === 1, 'y las ✕ para quitar quedan alineadas a la misma altura y con el mismo ancho')
}

/* ---- escáner dentro del constructor ---- */
{
  const { page: p, errors } = await newSession(browser, { legacy: false, context: { viewport: { width: 1300, height: 900 } } })
  p.setDefaultTimeout(15000)
  await newDeck(p)
  const target = CARDS.find((c) => c.displayName === 'Saul Bright: Stormrider')
  const scanBtn = p.getByRole('button', { name: 'Escanear' })
  ok(await scanBtn.isVisible(), 'el constructor tiene el botón Escanear')
  ok((await p.locator('.scan-embed').count()) === 0, 'el escáner no se abre solo')
  await scanBtn.click()
  await p.locator('.scan-embed').waitFor()
  await p.waitForFunction(() => !document.body.innerText.includes('Preparando el escáner'))
  const buf = fs.readFileSync(path.join(ROOT, 'public', target.image))
  await p.setInputFiles('.scan-embed input[type=file]', { name: 'carta.webp', mimeType: 'image/webp', buffer: buf })
  await p.locator('.scan-result').first().waitFor()
  const res = p.locator('.scan-result').filter({ hasText: target.displayName }).first()
  ok((await res.count()) === 1, 'el escáner propone la carta fotografiada')
  const chooseBtn = res.getByRole('button', { name: 'Añadir al mazo' })
  ok(await chooseBtn.isVisible(), 'el botón de cada candidata dice «Añadir al mazo»')
  await chooseBtn.click()
  await p.getByText(`Añadida: ${target.displayName}`).waitFor()
  ok(true, 'al confirmarla sale el aviso «Añadida»')
  const inDeck = p.locator('.editor-deck .deck-row', { hasText: target.displayName })
  ok((await inDeck.count()) === 1 && (await inDeck.locator('.stepper-n').innerText()) === '1', 'y la carta está en el mazo (1 copia)')
  await chooseBtn.click(); await chooseBtn.click()
  await p.waitForTimeout(150)
  ok((await inDeck.locator('.stepper-n').innerText()) === '3', 'se puede seguir escaneando y añadiendo hasta 3 copias')
  await chooseBtn.click()
  await p.getByText(/Máximo 3 copias/).waitFor()
  ok((await inDeck.locator('.stepper-n').innerText()) === '3', 'la 4.ª copia se rechaza con el motivo (las reglas del mazo se respetan)')
  // sideboard (las 3 copias máximas cuentan entre mazo y sideboard: se libera una)
  await inDeck.getByRole('button', { name: 'Quitar uno' }).click()
  await p.getByRole('button', { name: 'Al sideboard' }).click()
  await chooseBtn.click()
  await p.waitForTimeout(150)
  ok((await p.locator('ul.zone').nth(1).locator('.deck-row', { hasText: target.displayName }).count()) === 1, 'con «Al sideboard» elegido, el escáner añade al sideboard')
  await p.getByRole('button', { name: 'Cerrar escáner' }).click()
  ok((await p.locator('.scan-embed').count()) === 0, 'se cierra el escáner')
  const live = await p.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.srcObject).length)
  ok(live === 0, 'sin cámara activa al cerrar')
  ok(errors.length === 0, 'sin errores de página' + (errors.length ? ': ' + errors.join(' | ') : ''))
}

/* ---- el botón Escanear de Cartas ---- */
for (const W of [320, 375, 1300]) {
  const { page: p } = await newSession(browser, { legacy: false, context: W < 700 ? phone(W) : { viewport: { width: W, height: 900 } } })
  await p.goto(BASE + '#/'); await p.waitForSelector('.tile')
  const b = await p.getByRole('link', { name: /Escanear/ }).boundingBox()
  const h1 = await p.locator('h1').first().boundingBox()
  ok(b.x >= 0 && b.x + b.width <= W && b.height >= 36, `${W}px · el botón Escanear cabe en la pantalla (${Math.round(b.width)}×${Math.round(b.height)})`)
  ok(Math.abs(b.y - h1.y) < 60, `${W}px · y está arriba, junto al título (a ${Math.round(Math.abs(b.y - h1.y))}px)`)
  ok(await p.getByRole('link', { name: /Escanear/ }).locator('svg').count() === 1, `${W}px · lleva su icono de cámara`)
}

/* ---- el nombre del mazo se puede vaciar al escribir ---- */
{
  const { page: p } = await newSession(browser, { legacy: false })
  await newDeck(p)
  const input = p.getByLabel('Nombre del mazo')
  await input.fill('Mi mazo')
  await input.fill('')
  await p.waitForTimeout(900)
  ok((await input.inputValue()) === '', 'al borrar el nombre del mazo el campo se queda vacío (no se rellena solo)')
  await input.blur()
  ok((await input.inputValue()) === 'Sin nombre', 'al salir del campo vacío, el mazo se llama "Sin nombre"')
}

/* ---- borrar un mazo: cuadro de confirmación propio, no el del navegador ---- */
for (const [label, ctx, W] of [['escritorio', undefined, 1500], ['móvil 375', phone(375), 375]]) {
  const { page: p, store } = await newSession(browser, { legacy: false, ...(ctx ? { context: ctx } : {}) })
  let native = 0
  p.on('dialog', (d) => { native++; d.dismiss() })
  await newDeck(p)
  await p.goto(BASE + '#/decks'); await p.waitForSelector('.deck-card')
  const decksBefore = store.decks.size
  const del = p.getByRole('button', { name: 'Borrar' }).first()
  await del.click()
  const dlg = p.getByRole('alertdialog')
  await dlg.waitFor()
  ok(native === 0, `${label} · borrar no abre el cuadro del navegador`)
  ok(/borrar mazo/i.test(await dlg.innerText()), `${label} · el cuadro propio pregunta por el mazo`)
  ok(await dlg.getByRole('button', { name: 'Cancelar' }).evaluate((b) => b === document.activeElement), `${label} · el foco empieza en «Cancelar» (un Intro de más no borra)`)
  const box = await dlg.boundingBox()
  ok(box.x >= 0 && box.x + box.width <= W + 0.5, `${label} · el cuadro cabe en la pantalla (${Math.round(box.width)}px)`)
  const bBox = await dlg.getByRole('button', { name: 'Borrar' }).boundingBox()
  ok(bBox.height >= (W < 700 ? 44 : 30), `${label} · los botones tienen tamaño cómodo (${Math.round(bBox.height)}px de alto)`)
  await p.keyboard.press('Tab'); await p.keyboard.press('Tab')
  ok(await dlg.getByRole('button', { name: 'Cancelar' }).evaluate((b) => b === document.activeElement), `${label} · el foco no se escapa del cuadro con Tab`)
  await p.keyboard.press('Escape')
  ok((await p.getByRole('alertdialog').count()) === 0 && store.decks.size === decksBefore, `${label} · Escape cancela y el mazo sigue`)
  await p.waitForTimeout(150)
  await del.click(); await dlg.waitFor()
  await p.mouse.click(2, 2)
  ok((await p.getByRole('alertdialog').count()) === 0 && store.decks.size === decksBefore, `${label} · pulsar fuera cancela y el mazo sigue`)
  await del.click(); await dlg.waitFor()
  await dlg.getByRole('button', { name: 'Borrar' }).click(); await p.waitForTimeout(600)
  ok(store.decks.size === decksBefore - 1, `${label} · «Borrar» lo borra de verdad`)
  ok(native === 0, `${label} · en ningún momento salió un cuadro nativo`)
}

/* ---- el catálogo del editor va paginado como el de Cartas ---- */
for (const [label, ctx] of [['móvil 375', phone(375)], ['escritorio', undefined]]) {
  const { page: p } = await newSession(browser, { legacy: false, ...(ctx ? { context: ctx } : {}) })
  await newDeck(p)
  const tiles = p.locator('.editor-cards .tile')
  const info = p.locator('.editor-cards .pager-info').first()
  const n0 = await tiles.count()
  ok(n0 > 0 && n0 <= 48, `${label} · la primera página del catálogo tiene como mucho 48 fichas (${n0})`)
  ok(/^1–48 de \d+ cartas/.test((await info.innerText()).trim()), `${label} · el paginador indica el rango («${(await info.innerText()).trim()}»)`)
  if (ctx) {
    const h = await p.evaluate(() => document.documentElement.scrollHeight)
    ok(h < 14000, `${label} · la página ya no mide decenas de miles de píxeles (${h}px)`)
  }
  const firstName = () => tiles.first().getByRole('button', { name: /^Añadir / }).getAttribute('aria-label')
  const first = await firstName()
  await p.locator('.editor-cards').getByRole('button', { name: 'Página siguiente' }).first().click(); await p.waitForTimeout(300)
  ok(/^49–/.test((await info.innerText()).trim()) && (await firstName()) !== first, `${label} · «Siguiente» pasa a la página 2 con otras cartas`)
  await p.locator('.editor-cards input[type=search]').fill('Saul Bright'); await p.waitForTimeout(500)
  ok((await p.locator('.editor-cards .pager').count()) === 0 && (await tiles.count()) > 0, `${label} · al filtrar vuelve a la primera página (cabe todo y no hace falta paginador)`)
  await p.context().close()
}

await browser.close()
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
process.exit(failed ? 1 : 0)

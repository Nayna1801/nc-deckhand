import { chromium } from 'playwright'
import { BASE, CARDS } from '../config.mjs'
import { autoConfirm } from '../lib/confirm.mjs'
import { newSession } from '../lib/mock.mjs'

let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const browser = await chromium.launch()

const SET_ORDER = ['welcometonightcityretail', 'embracingpowerretailstarterdeck', 'theheistretailstarterdeck']
const setIdx = (c) => { const i = SET_ORDER.indexOf(c.setCode); return i === -1 ? SET_ORDER.length : i }
const num = (c) => parseInt(c.importId ?? '', 10) || 0
const catalogOrder = (a, b) => setIdx(a) - setIdx(b) || a.setCode.localeCompare(b.setCode) || num(a) - num(b) || a.displayName.localeCompare(b.displayName)

const OWNED = CARDS.slice(0, 20)
const owned = (store) => OWNED.forEach((c, i) => store.collection.set(c.id, { card_id: c.id, quantity: (i % 3) + 1, qty_foil: 0, qty_promo: 0, condition: 'mint', arts: {} }))
const ownedSorted = [...OWNED].sort(catalogOrder)
const notOwned = CARDS.filter((c) => !OWNED.includes(c) && c.type !== 'Legend')[5]

const phone = (w = 375) => ({ viewport: { width: w, height: 900 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
const labels = (p) => p.locator('.album-page:not(.blank) .pocket').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
const where = async (p) => (await p.locator('.album-where').innerText()).replace(/\s+/g, ' ').trim()
const overflowX = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

async function open(p, store) {
  await autoConfirm(p)
  await p.goto(BASE + '#/collection')
  await p.waitForSelector('.stats-row')
  await p.waitForSelector('.album')
}

async function fill(p, kind = 'Mis cartas', mode = 'Reemplazar todo') {
  await p.getByRole('button', { name: /Editar álbum/ }).click()
  const d = p.locator('.album-fill')
  if (!(await d.evaluate((e) => e.open))) await d.locator('summary').click()
  await d.getByRole('button', { name: kind, exact: true }).click()
  await d.getByRole('button', { name: mode, exact: true }).click()
  await d.getByRole('button', { name: /^Rellenar/ }).click()
  await p.waitForTimeout(250)
}

/* ---- álbum vacío y rellenado con la colección ---- */
{
  const { page: p, store, errors } = await newSession(browser, { legacy: false, context: { viewport: { width: 1300, height: 900 } } })
  owned(store)
  await open(p, store)
  ok((await p.getByRole('tab', { name: 'Álbum' }).getAttribute('aria-selected')) === 'true', 'la Colección abre en la pestaña Álbum')
  ok(/Tu álbum está vacío/.test(await p.locator('.album').innerText()), 'un álbum nuevo explica cómo empezar')
  ok((await p.locator('.album-page:not(.blank) .pocket.empty').count()) === 9 && (await p.locator('.album-page.blank').count()) === 1, 'en pantalla ancha se ve a doble página (una página de 9 bolsillos vacíos y la contraportada)')
  ok((await p.locator('.album-book').getAttribute('data-spread')) === '2', 'y está marcado como doble página')

  await fill(p)
  ok(/20 cartas · 3 páginas/.test(await p.locator('.album-count').innerText()), `«Mis cartas» coloca las ${OWNED.length} cartas que tienes (20 cartas · 3 páginas)`)
  const first = await labels(p)
  ok(first[0] === ownedSorted[0].displayName && first[8] === ownedSorted[8].displayName && first[9] === ownedSorted[9].displayName, 'en el orden del catálogo (set y número)')
  ok((await where(p)) === 'Páginas 1–2 de 3', `doble página: «${await where(p)}»`)
  await p.getByRole('button', { name: 'Página siguiente' }).click()
  ok((await where(p)) === 'Página 3 de 3' && (await p.locator('.album-page.blank').count()) === 1, 'la última página se ve sola con la contraportada en blanco')
  ok(await p.getByRole('button', { name: 'Página siguiente' }).isDisabled(), 'y «Siguiente» se desactiva')
  await p.getByRole('button', { name: 'Página anterior' }).click()
  ok((await where(p)) === 'Páginas 1–2 de 3', 'volver atrás')

  // tamaños de página
  const cols = () => p.locator('.album-grid').first().evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length)
  await p.getByRole('button', { name: '4×3' }).click()
  ok((await cols()) === 4 && /20 cartas · 2 páginas/.test(await p.locator('.album-count').innerText()), '4×3: 4 columnas y 2 páginas (12 por página)')
  await p.getByRole('button', { name: '2×2' }).click()
  ok((await cols()) === 2 && /20 cartas · 5 páginas/.test(await p.locator('.album-count').innerText()), '2×2: 2 columnas y 5 páginas')
  await p.getByRole('button', { name: '3×3' }).click()
  ok((await labels(p))[0] === ownedSorted[0].displayName, 'cambiar el tamaño no pierde ni reordena las cartas')
  ok(errors.length === 0, 'sin errores de página' + (errors.length ? ': ' + errors.join(' | ') : ''))
}

/* ---- editar: mover, vaciar, elegir carta y arte; y que se guarda ---- */
{
  const { page: p, store, errors } = await newSession(browser, { legacy: false, context: { viewport: { width: 900, height: 900 } } })
  owned(store)
  await open(p, store)
  await fill(p)
  const at = () => labels(p)
  const before = await at()
  // seleccionar y mover (intercambiar)
  await p.locator('.pocket').nth(0).click()
  ok((await p.locator('.pocket.sel').count()) === 1 && /Seleccionada/.test(await p.locator('.album-edit').innerText()), 'tocar una carta en modo edición la selecciona')
  await p.locator('.pocket').nth(1).click()
  const after = await at()
  ok(after[0] === before[1] && after[1] === before[0], 'tocar después otro bolsillo intercambia las dos cartas')
  ok((await p.locator('.pocket.sel').count()) === 0, 'y la selección se limpia')
  // arrastrar y soltar (ordenador)
  await p.locator('.pocket').nth(2).dragTo(p.locator('.pocket').nth(3))
  const dragged = await at()
  ok(dragged[2] === before[3] && dragged[3] === before[2], 'arrastrar una carta sobre otra también las intercambia')
  // vaciar un bolsillo
  await p.locator('.pocket').nth(4).click()
  await p.getByRole('button', { name: 'Vaciar bolsillo' }).click()
  ok((await p.locator('.pocket.empty').nth(0).getAttribute('aria-label')).startsWith('Bolsillo vacío 5'), 'Vaciar bolsillo deja el hueco en su sitio')
  // quitar el bolsillo desplaza el resto
  await p.locator('.pocket').nth(5).click()
  const six = (await at())[6]
  await p.getByRole('button', { name: 'Quitar bolsillo' }).click()
  ok((await at())[5] === six, 'Quitar bolsillo sube las siguientes una posición')
  // insertar un hueco
  await p.locator('.pocket').nth(0).click()
  const zero = (await at())[0]
  await p.getByRole('button', { name: 'Insertar hueco antes' }).click()
  ok((await at())[0].startsWith('Bolsillo vacío') && (await at())[1] === zero, 'Insertar hueco antes baja las siguientes')

  // elegir una carta para un bolsillo vacío
  await p.locator('.pocket.empty').first().click()
  const dlg = p.getByRole('dialog', { name: /Elegir carta/ })
  await dlg.waitFor()
  ok(await dlg.getByRole('checkbox', { name: /Solo las que tengo/ }).isChecked(), 'el selector empieza mostrando solo las cartas que tienes')
  await dlg.getByRole('searchbox').fill(notOwned.displayName); await p.waitForTimeout(150)
  ok(/No tienes ninguna carta que coincida/.test(await dlg.innerText()), 'una carta que no tienes no sale con «Solo las que tengo»')
  await dlg.getByRole('checkbox', { name: /Solo las que tengo/ }).uncheck()
  await dlg.locator(`.tile-art[aria-label^="${notOwned.displayName}"]`).first().click()
  await dlg.waitFor({ state: 'detached' })
  const mine = p.locator(`.pocket[aria-label^="${notOwned.displayName}"]`)
  ok((await mine.count()) === 1, 'elegir una carta la coloca en el bolsillo')
  ok(/no la tengo/i.test(await mine.locator('.pocket-tag').innerText()), 'una carta que no tienes se marca «No la tengo» (sirve de hueco para las que te faltan)')

  // elegir un arte alternativo concreto
  const withAlt = CARDS.find((c) => c.altArts.some((a) => a.image) && !OWNED.includes(c))
  await p.locator('.pocket.empty').first().click()
  await dlg.waitFor()
  await dlg.getByRole('checkbox', { name: /Solo las que tengo/ }).uncheck()
  await dlg.getByRole('checkbox', { name: /Solo artes alternativos/ }).check()
  await dlg.getByRole('searchbox').fill(withAlt.displayName); await p.waitForTimeout(150)
  const artTile = dlg.locator(`.tile-art[aria-label^="${withAlt.displayName}"]`).first()
  const artSrc = await artTile.locator('img').getAttribute('src')
  await artTile.click()
  const placed = p.locator(`.pocket[aria-label^="${withAlt.displayName}"]`).first()
  ok((await placed.getAttribute('aria-label')).includes('#'), 'el bolsillo recuerda la impresión (set y número) del arte elegido')
  ok((await placed.locator('img').getAttribute('src')) === artSrc, 'y enseña la imagen de ese arte, no la del diseño base')

  // ver una carta en modo normal
  await p.getByRole('button', { name: /Terminar/ }).click()
  await p.locator('.pocket.has').first().click()
  await p.locator('.modal').waitFor()
  ok((await p.locator('.modal h2').innerText()).length > 0, 'fuera del modo edición, pulsar una carta abre su ficha')
  await p.keyboard.press('Escape')

  // se conserva al recargar
  const saved = await at()
  await p.reload(); await p.waitForSelector('.album')
  ok(JSON.stringify(await at()) === JSON.stringify(saved), 'el álbum se conserva al recargar la página')
  ok(await p.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('ncd.album.v1.00000000'))), 'se guarda con una clave propia de la cuenta')
  ok(errors.length === 0, 'sin errores de página' + (errors.length ? ': ' + errors.join(' | ') : ''))

  // páginas: añadir, quitar y vaciar
  await p.getByRole('button', { name: /Editar álbum/ }).click()
  const pagesBefore = Number((await p.locator('.album-count').innerText()).match(/(\d+) página/)[1])
  await p.getByRole('button', { name: '+ Añadir página' }).click()
  ok(Number((await p.locator('.album-count').innerText()).match(/(\d+) página/)[1]) === pagesBefore + 1, 'Añadir página crea una página más')
  ok(/Página \d+ de/.test(await where(p)) && (await p.locator('.album-page .pocket.empty').count()) === 9, 'y te lleva a ella (vacía)')
  await p.getByRole('button', { name: /Quitar página/ }).click()
  ok(Number((await p.locator('.album-count').innerText()).match(/(\d+) página/)[1]) === pagesBefore, 'Quitar página la elimina')
  await p.getByRole('button', { name: 'Vaciar álbum' }).click()
  await p.waitForFunction(() => /^0 cartas · 1 página/.test((document.querySelector('.album-count')?.textContent ?? '').trim()), null, { timeout: 3000 }).catch(() => {})
  ok(/^0 cartas · 1 página/.test((await p.locator('.album-count').innerText()).trim()), 'Vaciar álbum lo deja en blanco')
}

/* ---- el selector de cartas recuerda dónde te quedaste ---- */
for (const mobile of [false, true]) {
  const tag = mobile ? 'móvil' : 'escritorio'
  const { page: p, store } = await newSession(browser, { legacy: false, context: mobile ? phone(390) : { viewport: { width: 900, height: 900 } } })
  owned(store)
  await open(p, store)
  await p.getByRole('button', { name: /Editar álbum/ }).click()
  const dlg = p.getByRole('dialog', { name: /Elegir carta/ })
  const scroller = dlg.locator('.picker-body')
  const pageNow = async () => Number(await dlg.locator('.pager-pages [aria-current=page]').innerText())
  const top = () => scroller.evaluate((e) => Math.round(e.scrollTop))
  const emptyPocket = () => p.locator('.pocket.empty').first()

  await emptyPocket().click(); await dlg.waitFor()
  ok((await pageNow().catch(() => 1)) === 1 && (await top()) === 0, `${tag} · la primera vez abre arriba, en la primera página`)
  await dlg.getByRole('checkbox', { name: /Solo las que tengo/ }).uncheck()
  await dlg.getByRole('button', { name: 'Página 2', exact: true }).click()
  ok((await pageNow()) === 2, `${tag} · se pasa a la página 2 de resultados`)
  await scroller.evaluate((e) => { e.scrollTop = 420 })
  await p.waitForTimeout(200)
  const seen = await top()
  ok(seen > 300, `${tag} · se baja por la página (scroll ${seen}px)`)
  // elegir una carta de la página 2 cierra la ventana
  await dlg.locator('.picker-grid .tile-art').nth(3).click()
  await dlg.waitFor({ state: 'detached' })

  await emptyPocket().click(); await dlg.waitFor()
  ok((await pageNow()) === 2, `${tag} · al abrir otro bolsillo vuelve a la página 2`)
  ok(Math.abs((await top()) - seen) <= 4, `${tag} · y en la misma posición del scroll (${await top()}px de ${seen}px)`)
  ok(!(await dlg.getByRole('checkbox', { name: /Solo las que tengo/ }).isChecked()), `${tag} · y con los filtros como los dejaste`)

  // cambiar la búsqueda vuelve al principio de los resultados; y se recuerda también
  await dlg.getByRole('searchbox').fill('a'); await p.waitForTimeout(250)
  ok((await pageNow()) === 1 && (await top()) === 0, `${tag} · al cambiar la búsqueda se vuelve a la página 1, arriba`)
  await dlg.getByRole('button', { name: 'Página 2', exact: true }).click()
  await p.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' })
  await emptyPocket().click(); await dlg.waitFor()
  ok((await dlg.getByRole('searchbox').inputValue()) === 'a' && (await pageNow()) === 2, `${tag} · cerrar sin elegir (Escape) también recuerda búsqueda y página`)

  // se conserva al recargar la página (misma pestaña)
  await p.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' })
  await p.reload(); await p.waitForSelector('.album')
  await p.getByRole('button', { name: /Editar álbum/ }).click()
  await emptyPocket().click(); await dlg.waitFor()
  ok((await dlg.getByRole('searchbox').inputValue()) === 'a' && (await pageNow()) === 2, `${tag} · y sobrevive a recargar la página`)

  // empezar de cero
  const restart = dlg.getByRole('button', { name: 'Empezar de cero' })
  ok(await restart.isVisible(), `${tag} · con algo recordado se ofrece «Empezar de cero»`)
  await restart.click()
  ok((await dlg.getByRole('searchbox').inputValue()) === '' && (await dlg.getByRole('checkbox', { name: /Solo las que tengo/ }).isChecked()) && (await top()) === 0, `${tag} · «Empezar de cero» limpia búsqueda y filtros y vuelve arriba`)
  ok((await restart.count()) === 0, `${tag} · y el botón desaparece`)
  if (mobile) {
    ok((await dlg.getByRole('searchbox').evaluate((e) => e === document.activeElement)) === false, 'móvil · la ventana no abre el teclado sola')
    const box = await dlg.boundingBox()
    ok(box.x >= -1 && box.x + box.width <= 390 + 1, 'móvil · y cabe en la pantalla')
  }
}

/* ---- «todo junto» con artes y promos, y el nombre ---- */
{
  const { page: p, store } = await newSession(browser, { legacy: false, context: { viewport: { width: 900, height: 900 } } })
  const adam = CARDS.find((c) => c.id === 'adam_smasher_ender_of_legends')
  const art = adam.altArts.find((a) => a.image)
  store.collection.set(adam.id, { card_id: adam.id, quantity: 1, qty_foil: 0, qty_promo: 0, condition: 'mint', arts: { [`alt:${art.id}`]: 1 } })
  await open(p, store)
  await fill(p, 'Todo junto')
  const l = await labels(p)
  ok(l[0] === adam.displayName && l[1].startsWith(adam.displayName) && l[1].includes('#'), '«Todo junto» pone el diseño base y, justo después, el arte alternativo que tienes')
  ok(/2 cartas/.test(await p.locator('.album-count').innerText()), 'solo lo que tienes: 2 cartas')
  await p.locator('.album-name').fill('Mis Legends')
  await p.getByRole('button', { name: /Terminar/ }).click()
  ok((await p.locator('.album-title').innerText()) === 'Mis Legends', 'el nombre del álbum se puede cambiar')
}

/* ---- el móvil: una página, deslizar, sin desbordes y con controles táctiles ---- */
for (const W of [320, 360, 390, 768]) {
  const { page: p, store } = await newSession(browser, { legacy: false, context: phone(W) })
  owned(store)
  await open(p, store)
  ok((await overflowX(p)) <= 1, `${W}px · Álbum vacío: sin desbordes`)
  await fill(p)
  ok((await p.locator('.album-page:not(.blank)').count()) === 1 && (await p.locator('.album-book').getAttribute('data-spread')) === '1', `${W}px · se ve una sola página`)
  const out = await p.evaluate((vw) => [...document.querySelectorAll('.album .pocket, .album-nav .btn, .album-tools .btn, .album-tools .seg button')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1 }).length, W)
  ok(out === 0 && (await overflowX(p)) <= 1, `${W}px · bolsillos y botones dentro de la pantalla`)
  const small = await p.evaluate(() => [...document.querySelectorAll('.album-nav .btn, .album-tools .btn')].filter((e) => e.getBoundingClientRect().height < 36).length)
  ok(small === 0, `${W}px · los botones del álbum se pueden pulsar con el dedo (≥ 36px)`)
  await p.getByRole('button', { name: /Terminar/ }).click()
  // pasar página con el botón
  await p.getByRole('button', { name: 'Página siguiente' }).click()
  ok((await where(p)) === 'Página 2 de 3', `${W}px · «${await where(p)}»`)
  // selector de cartas
  await p.getByRole('button', { name: /Editar álbum/ }).click()
  await p.getByRole('button', { name: 'Página siguiente' }).click()
  await p.locator('.pocket.empty').first().click()
  const box = await p.getByRole('dialog').boundingBox()
  ok(box.x >= -1 && box.x + box.width <= W + 1, `${W}px · la ventana de elegir carta cabe en el ancho`)
  ok((await overflowX(p)) <= 1, `${W}px · y sin desbordes con ella abierta`)
  const closeBtn = await p.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).boundingBox()
  ok(closeBtn.y >= 0 && closeBtn.y + closeBtn.height <= 900, `${W}px · y su botón de cerrar está a la vista`)
  await p.keyboard.press('Escape')
  ok((await p.getByRole('dialog').count()) === 0, `${W}px · Escape la cierra`)
}

/* ---- deslizar para pasar página (táctil) ---- */
{
  const { page: p, store, ctx } = await newSession(browser, { legacy: false, context: phone(390) })
  owned(store)
  await open(p, store)
  await fill(p)
  await p.getByRole('button', { name: /Terminar/ }).click()
  const cdp = await ctx.newCDPSession(p)
  const box = await p.locator('.album-book').boundingBox()
  const y = box.y + box.height / 2
  const swipe = async (x0, x1) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] })
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 6, y }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await p.waitForTimeout(250)
  }
  await swipe(330, 120)
  ok((await where(p)) === 'Página 2 de 3', 'deslizar hacia la izquierda pasa a la página siguiente')
  await swipe(100, 320)
  ok((await where(p)) === 'Página 1 de 3', 'y hacia la derecha vuelve a la anterior')
}

await browser.close()
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
process.exit(failed ? 1 : 0)

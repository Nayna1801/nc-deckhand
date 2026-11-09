import { chromium } from 'playwright'
import { BASE } from '../config.mjs'
import { newSession } from '../lib/mock.mjs'

let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const browser = await chromium.launch()
const WIDTHS = [320, 360, 390, 768]

/** Mide, dentro de la página, todo lo que se sale de la pantalla (excepto lo que está en un desplegable cerrado). */
const measure = (p) => p.evaluate(() => {
  const vw = document.documentElement.clientWidth
  const closed = (el) => { for (let a = el.parentElement; a; a = a.parentElement) if (a.tagName === 'DETAILS' && !a.open && !el.closest('summary')) return true; return false }
  const outside = []
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || closed(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right > vw + 1 || r.left < -1) outside.push(`${el.tagName.toLowerCase()}.${(el.className?.toString?.() ?? '').split(' ')[0]}[${Math.round(r.left)}..${Math.round(r.right)}]`)
  }
  // contenedores que se desplazan en horizontal sin que deban (solo la navegación superior puede)
  const scrolls = [...document.querySelectorAll('body *')]
    .filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1 && !el.matches('.topbar nav') && !closed(el))
    .map((el) => `${el.tagName.toLowerCase()}.${(el.className?.toString?.() ?? '').split(' ')[0]} scroll ${el.scrollWidth}>${el.clientWidth}`)
  return { sw: document.documentElement.scrollWidth, vw, outside: outside.slice(0, 5), scrolls: scrolls.slice(0, 5) }
})

const check = async (p, label, w) => {
  const m = await measure(p)
  const good = m.sw <= m.vw + 1 && m.outside.length === 0 && m.scrolls.length === 0
  ok(good, `${w}px · ${label}: sin nada fuera de la pantalla${good ? '' : ` (scrollWidth ${m.sw}/${m.vw}; ${[...m.scrolls, ...m.outside].join(', ')})`}`)
}

const seed = (store) => {
  store.collection.set('adam_smasher_ender_of_legends', { card_id: 'adam_smasher_ender_of_legends', quantity: 1, qty_foil: 1, qty_promo: 1, condition: 'mint', arts: { 'alt:prm01_008': 1, 'alt:welcometonightcitybeta_141': 2, 'alt:welcometonightcityretail_141': 1 } })
  store.collection.set('saul_bright_stormrider', { card_id: 'saul_bright_stormrider', quantity: 5, qty_foil: 0, qty_promo: 0, condition: 'mint', arts: {} })
}

/* ---- ningún elemento se sale de la pantalla en ninguna página, a ningún ancho ---- */
for (const W of WIDTHS) {
  const { page: p, store, ctx, errors } = await newSession(browser, { legacy: false, context: { viewport: { width: W, height: 800 } } })
  seed(store)
  p.setDefaultTimeout(10000)
  await p.goto(BASE); await p.waitForSelector('.tile')
  await check(p, 'Cartas (galería)', W)
  const toggle = p.locator('.fp-toggle')
  if (await toggle.isVisible()) await toggle.click()
  await check(p, 'Cartas con los filtros abiertos', W)
  await p.getByRole('button', { name: /Lista/ }).click(); await check(p, 'Cartas (lista)', W)
  await p.getByRole('button', { name: /Galería/ }).click()
  await p.getByRole('button', { name: 'Por impresión' }).click(); await check(p, 'Cartas por impresión', W)
  await p.getByRole('button', { name: 'Por carta' }).click()
  await p.locator('input[type=search]').fill('name:"Adam Smasher: Ender"'); await p.waitForTimeout(450)
  await p.locator('.tile-art').first().click(); await p.locator('.modal').waitFor(); await p.waitForTimeout(300)
  await check(p, 'ficha de una carta con artes (con sesión)', W)
  await p.locator('.modal-scroll').evaluate((m) => (m.scrollTop = m.scrollHeight)); await check(p, 'ficha, parte final', W)
  const box = await p.locator('.modal').boundingBox()
  ok(box.x >= -1 && box.x + box.width <= W + 1, `${W}px · la ficha cabe entera en el ancho (${Math.round(box.x)}..${Math.round(box.x + box.width)})`)
  const img = await p.locator('.modal-img').boundingBox()
  ok(img.x >= 0 && img.x + img.width <= W + 1, `${W}px · la imagen de la carta en la ficha está dentro de la pantalla`)
  await p.keyboard.press('Escape')

  await p.goto(BASE + '#/collection'); await p.waitForSelector('.stats-row'); await check(p, 'Colección', W)
  await p.getByRole('tab', { name: /deseos/ }).click(); await check(p, 'Colección › Mis deseos', W)
  await p.getByRole('tab', { name: /Bulk/ }).click(); await check(p, 'Colección › Bulk', W)
  await p.locator('.bulk-row', { hasText: 'Adam' }).locator('summary').click(); await p.waitForTimeout(250)
  await check(p, 'Colección › Bulk con «Elegir qué retirar»', W)
  const nameBox = await p.locator('.bulk-row', { hasText: 'Adam' }).locator('.link-btn').first().boundingBox()
  ok(nameBox.width > W * 0.5, `${W}px · en el Bulk el nombre de la carta tiene sitio para leerse (${Math.round(nameBox.width)}px)`)
  await p.locator('.bulk-row .link-btn', { hasText: 'Adam' }).first().click(); await p.locator('.modal').waitFor(); await p.waitForTimeout(300)
  await check(p, 'ficha abierta desde el Bulk', W)
  await p.keyboard.press('Escape')

  await p.goto(BASE + '#/decks'); await p.waitForTimeout(400); await check(p, 'Mazos', W)
  await p.getByRole('button', { name: 'Nuevo mazo' }).click(); await p.waitForURL(/#\/decks\/.+/); await p.waitForSelector('.editor-cards .tile')
  await check(p, 'Editor de mazo', W)
  await p.goto(BASE + '#/scan'); await p.waitForTimeout(500); await check(p, 'Escáner', W)
  await p.goto(BASE + '#/login'); await p.waitForTimeout(300); await check(p, 'Inicio de sesión', W)
  ok(errors.length === 0, `${W}px · sin errores de página`)
  await ctx.close()
}

/* ---- pantalla táctil: todo lo que se pulsa tiene un tamaño razonable para el dedo ---- */
{
  const { page: p, store, ctx } = await newSession(browser, { legacy: false, context: { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true } })
  seed(store)
  p.setDefaultTimeout(10000)
  const small = (min = 36) => p.evaluate((m) => [...document.querySelectorAll('button, a, input[type=checkbox], select, summary, [role=tab], label.tap-box')]
    .filter((e) => {
      const cs = getComputedStyle(e)
      if (cs.display === 'none' || (e.closest('details') && !e.closest('details').open && e.tagName !== 'SUMMARY')) return false
      if (e.matches('input[type=checkbox]') && e.closest('label.tap-box')) return false // la etiqueta que la envuelve es el área de pulsación
      if (e.closest('.dd-pop')) return false
      const r = e.getBoundingClientRect()
      return r.width > 0 && (r.height < m || r.width < m)
    })
    .map((e) => `${e.tagName.toLowerCase()}.${(e.className?.toString?.() ?? '').split(' ')[0]}(${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)})`).slice(0, 6), min)
  await p.goto(BASE); await p.waitForSelector('.tile')
  let s = await small(); ok(s.length === 0, `táctil · Cartas: controles de al menos 36 px${s.length ? ' (pequeños: ' + s.join(', ') + ')' : ''}`)
  await p.locator('.tile-art').first().click(); await p.locator('.modal').waitFor(); await p.waitForTimeout(300)
  s = await small(); ok(s.length === 0, `táctil · ficha de carta${s.length ? ' (pequeños: ' + s.join(', ') + ')' : ''}`)
  await p.keyboard.press('Escape')
  await p.goto(BASE + '#/collection'); await p.waitForSelector('.stats-row'); await p.getByRole('tab', { name: /Bulk/ }).click()
  await p.locator('.bulk-row', { hasText: 'Adam' }).locator('summary').click(); await p.waitForTimeout(200)
  s = await small(); ok(s.length === 0, `táctil · Bulk con el desplegable abierto${s.length ? ' (pequeños: ' + s.join(', ') + ')' : ''}`)
  const steppers = await p.locator('.bulk-pick .stepper .btn').first().boundingBox()
  ok(steppers.width >= 40 && steppers.height >= 40, `táctil · los − y + del desplegable miden ${Math.round(steppers.width)}x${Math.round(steppers.height)} px`)
  await p.goto(BASE + '#/scan'); await p.waitForTimeout(400)
  s = await small(); ok(s.length === 0, `táctil · Escáner${s.length ? ' (pequeños: ' + s.join(', ') + ')' : ''}`)
  await ctx.close()
}

/* ---- la ficha de carta en el móvil se puede cerrar siempre ---- */
for (const [W, H] of [[320, 568], [360, 640], [390, 844]]) {
  const { page: p, store, ctx } = await newSession(browser, { legacy: false, context: { viewport: { width: W, height: H }, isMobile: true, hasTouch: true } })
  seed(store)
  p.setDefaultTimeout(10000)
  const cdp = await ctx.newCDPSession(p)
  // dedo real: toca, arrastra en pasos pequeños y suelta (el gesto sintético de CDP no desplaza nada en este navegador)
  const swipe = async (dy) => {
    const x = W / 2, y = H / 2, steps = 24
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / steps }] }); await new Promise((r) => setTimeout(r, 10)) }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await p.waitForTimeout(500)
  }
  // un toque mientras la ficha todavía resbala por la inercia solo la detiene: como haría una persona, se vuelve a tocar
  const tapClose = async (x, y) => {
    for (let i = 0; i < 4 && (await isOpen()); i++) { await p.touchscreen.tap(x, y); await p.waitForTimeout(700) }
  }
  const open = async () => { await p.locator('.tile-art').first().click(); await p.locator('.modal').waitFor(); await p.waitForTimeout(250) }
  // la barra de direcciones del navegador móvil se come parte de la pantalla: el fondo fijo mide menos que 100vh
  const barOn = () => p.evaluate(() => { const b = document.querySelector('.modal-backdrop'); b.style.height = `${innerHeight * 0.88}px`; b.style.bottom = 'auto' })
  const reach = () => p.evaluate(() => { const m = document.querySelector('.modal').getBoundingClientRect(), x = document.querySelector('.modal-x').getBoundingClientRect(); return { top: m.top, bottom: m.bottom, xTop: x.top, xBottom: x.bottom, xLeft: x.left, xRight: x.right, vh: innerHeight } })
  const isOpen = () => p.locator('.modal').count().then((n) => n > 0)

  await p.goto(BASE); await p.waitForSelector('.tile')
  await open(); await barOn(); await p.waitForTimeout(200)
  let r = await reach()
  ok(r.top >= 0 && r.xTop >= 0 && r.xBottom <= r.vh, `${W}x${H} · con la barra del navegador visible, la ficha y su botón de cerrar caben en la pantalla (ficha ${Math.round(r.top)}..${Math.round(r.bottom)}, X ${Math.round(r.xTop)}..${Math.round(r.xBottom)})`)
  ok(r.top >= 24, `${W}x${H} · queda una franja libre arriba para tocar fuera (${Math.round(r.top)} px)`)
  ok(r.xRight - r.xLeft >= 40 && r.xBottom - r.xTop >= 40, `${W}x${H} · el botón X es grande (${Math.round(r.xRight - r.xLeft)}x${Math.round(r.xBottom - r.xTop)} px)`)
  const scrollY0 = await p.evaluate(() => scrollY)
  ok(await p.evaluate(() => getComputedStyle(document.documentElement).overflow === 'hidden'), `${W}x${H} · con la ficha abierta la página de detrás queda bloqueada`)

  // deslizar con el dedo dentro de la ficha, hacia abajo y de vuelta hacia arriba
  await swipe(-500)
  const mid = await p.locator('.modal-scroll').evaluate((m) => m.scrollTop)
  await swipe(900)
  const back = await p.locator('.modal-scroll').evaluate((m) => m.scrollTop)
  ok(mid > 50 && back < 5, `${W}x${H} · se puede deslizar la ficha hacia abajo (${Math.round(mid)} px) y volver arriba (${Math.round(back)} px)`)
  ok((await p.evaluate(() => scrollY)) === scrollY0, `${W}x${H} · al deslizar la ficha no se mueve la página de detrás`)
  r = await reach()
  ok(r.xTop >= 0 && r.xBottom <= r.vh, `${W}x${H} · el botón de cerrar sigue a la vista tras deslizar`)

  // cerrar tocando la X
  await tapClose((r.xLeft + r.xRight) / 2, (r.xTop + r.xBottom) / 2)
  ok(!(await isOpen()), `${W}x${H} · tocar la X cierra la ficha`)
  ok(await p.evaluate(() => getComputedStyle(document.documentElement).overflow !== 'hidden'), `${W}x${H} · al cerrar, la página vuelve a poder desplazarse`)

  // cerrar tocando fuera (la franja de arriba)
  await open(); await barOn(); await p.waitForTimeout(200)
  await p.touchscreen.tap(W / 2, 12)
  await p.waitForTimeout(250)
  ok(!(await isOpen()), `${W}x${H} · tocar fuera de la ficha, en la franja de arriba, la cierra`)

  // cerrar con el botón del final de la ficha (sin volver arriba)
  await open(); await barOn(); await p.waitForTimeout(200)
  await p.locator('.modal-scroll').evaluate((m) => (m.scrollTop = m.scrollHeight)) // hasta el final de la ficha
  await p.waitForTimeout(300)
  const bottomBtn = p.getByRole('button', { name: 'Cerrar ficha' })
  const bb = await bottomBtn.boundingBox()
  ok(bb && bb.y >= 0 && bb.y + bb.height <= H && bb.height >= 40, `${W}x${H} · al final de la ficha hay un botón «Cerrar ficha» a la vista (${Math.round(bb?.y ?? -1)}..${Math.round((bb?.y ?? 0) + (bb?.height ?? 0))} de ${H} px)`)
  await tapClose(bb.x + bb.width / 2, bb.y + bb.height / 2)
  ok(!(await isOpen()), `${W}x${H} · «Cerrar ficha» cierra la ficha`)
  await ctx.close()
}

/* ---- cabecera: «Iniciar sesión» / «Salir» bien puestos en el móvil, con o sin sesión y con un correo largo ---- */
{
  const LONG = 'alejandro.garces.rodriguez1998@gmail.com'
  for (const mode of ['invitado', 'con sesión', 'con sesión y correo largo']) {
    for (const w of [320, 360, 390]) {
      const context = { viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true }
      let p
      if (mode === 'invitado') p = await (await browser.newContext(context)).newPage()
      else {
        ;({ page: p } = await newSession(browser, { legacy: false, context }))
        if (mode.includes('largo')) {
          await p.context().addInitScript((e) => { for (const k of Object.keys(localStorage)) if (k.endsWith('-auth-token')) { const s = JSON.parse(localStorage.getItem(k)); s.user.email = e; localStorage.setItem(k, JSON.stringify(s)) } }, LONG)
        }
      }
      await p.goto(BASE + '#/'); await p.waitForSelector('.topbar .who .btn'); await p.waitForTimeout(400)
      const m = await p.evaluate(() => {
        const box = (s) => document.querySelector(s).getBoundingClientRect()
        const btn = document.querySelector('.who .btn')
        const t = btn.getBoundingClientRect()
        const range = document.createRange(); range.selectNodeContents(btn)
        const tr = range.getBoundingClientRect()
        return {
          h: box('.topbar').height, sameRow: Math.abs(box('.brand').top - box('.who').top) < 12, right: document.documentElement.clientWidth - t.right,
          centered: Math.abs(tr.top + tr.height / 2 - (t.top + t.height / 2)) < 2, btnH: t.height, over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      })
      ok(m.sameRow && m.h <= 110, `${w}px · ${mode}: logo y botón en la misma fila (cabecera de ${Math.round(m.h)}px)`)
      ok(m.right >= 4 && m.right <= 20, `${w}px · ${mode}: el botón queda pegado al borde derecho (a ${Math.round(m.right)}px)`)
      ok(m.centered && m.btnH >= 40, `${w}px · ${mode}: el texto del botón está centrado y se puede pulsar (${Math.round(m.btnH)}px)`)
      ok(m.over <= 0, `${w}px · ${mode}: la cabecera no ensancha la página`)
      await p.context().close()
    }
  }
}

/* ---- bulk en el móvil: el cuadro de selección va en la misma línea que el nombre de la carta ---- */
for (const w of [320, 375]) {
  const { page: p, store } = await newSession(browser, { legacy: false, context: { viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true } })
  seed(store)
  await p.goto(BASE + '#/collection'); await p.waitForSelector('.stats-row')
  await p.getByRole('tab', { name: /Bulk/ }).click(); await p.waitForSelector('.bulk-row')
  const m = await p.evaluate(() => [...document.querySelectorAll('.bulk-row > .deck-row')].map((r) => {
    const c = r.querySelector('.tap-box').getBoundingClientRect(); const n = r.querySelector('.link-btn').getBoundingClientRect()
    return Math.abs(c.top + c.height / 2 - (n.top + Math.min(n.height, 44) / 2)) < 14
  }))
  ok(m.length > 0 && m.every(Boolean), `${w}px · bulk: el cuadro de selección y el nombre van en la misma línea (${m.length} filas)`)
  await p.context().close()
}

await browser.close()
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
process.exit(failed ? 1 : 0)

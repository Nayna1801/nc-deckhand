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

await browser.close()
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
process.exit(failed ? 1 : 0)

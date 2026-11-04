import { chromium } from 'playwright'
import { BASE, SHOTS } from '../config.mjs'
import { isCyan, isDark, isYellow, pixelsAt, stripPoints } from '../lib/pixels.mjs'

// Fondos y legibilidad de los paneles con scroll: el relleno debe cubrir TODO el contenido, también al bajar.
// (Si el relleno solo cubriera la parte visible, al hacer scroll el texto quedaría sobre el color del borde.)

let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }
const browser = await chromium.launch()
const errors = []

async function page(viewport, touch = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 })
  const p = await ctx.newPage()
  p.setDefaultTimeout(8000)
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  await p.goto(BASE)
  await p.waitForSelector('.tile')
  return { p, ctx }
}


/**
 * Guarda contra la causa del fallo: un elemento que hace scroll por sí mismo Y pinta su relleno con ::before
 * (el relleno solo mide la parte visible). El scroll debe ir en una caja interior.
 */
async function scrollingWithPseudoFill(p) {
  return p.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((el) => {
        const cs = getComputedStyle(el)
        const scrolls = ['auto', 'scroll'].includes(cs.overflowY) && el.scrollHeight > el.clientHeight + 1
        const pseudo = getComputedStyle(el, '::before').content
        return scrolls && pseudo !== 'none' && pseudo !== 'normal'
      })
      .map((el) => el.className || el.tagName),
  )
}
const noPseudoScroll = async (p, label) => {
  const bad = await scrollingWithPseudoFill(p)
  ok(bad.length === 0, `${label}: ningún panel con scroll pinta su relleno con ::before${bad.length ? ' — ' + bad.join(', ') : ''}`)
}

/** Revisa la franja interior izquierda de una caja: ningún punto puede ser del color del borde y todos deben ser oscuros. */
async function checkStrip(p, boxSel, scrollSel, label, edge, inset = 6) {
  const scroller = p.locator(scrollSel)
  const info = await scroller.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
  ok(info.sh > info.ch + 80, `${label}: el contenido hace scroll (${info.sh}px en ${info.ch}px)`)
  const stops = [0, 0.5, 1]
  let bad = 0
  let total = 0
  const samples = []
  for (const f of stops) {
    await scroller.evaluate((el, f) => (el.scrollTop = (el.scrollHeight - el.clientHeight) * f), f)
    await p.waitForTimeout(120)
    const box = await p.locator(boxSel).boundingBox()
    // franja vacía: `inset` px dentro del borde izquierdo (relleno, antes del contenido); se evitan las esquinas cortadas
    const pts = stripPoints(box.x + inset, box.y + 40, box.y + box.height - 40)
    const px = await pixelsAt(p, pts)
    px.forEach((c, i) => {
      total++
      if (edge(c) || !isDark(c)) {
        bad++
        if (samples.length < 3) samples.push(`(${Math.round(pts[i].x)},${Math.round(pts[i].y)}) = rgb(${c.slice(0, 3).join(',')}) con scroll al ${Math.round(f * 100)}%`)
      }
    })
  }
  ok(bad === 0, `${label}: el fondo es oscuro en todo el recorrido del scroll (${total - bad}/${total} puntos)${samples.length ? ' — ' + samples.join('; ') : ''}`)
}

/* 1. detalle de carta en móvil (el caso reportado: Adam Smasher, mucho contenido) */
{
  const { p, ctx } = await page({ width: 390, height: 800 }, true)
  await p.locator('input[type=search]').fill('name:"Adam Smasher: Ender"')
  await p.waitForTimeout(450)
  await p.locator('.tile-art').first().click()
  await p.locator('.modal').waitFor()
  await checkStrip(p, '.modal', '.modal-scroll', 'modal en móvil (Adam Smasher)', isYellow)
  await noPseudoScroll(p, 'modal')
  await p.screenshot({ path: `${SHOTS}/v1-modal-mobile.png` })
  await ctx.close()
}

/* 2. el mismo detalle en una ventana baja de escritorio */
{
  const { p, ctx } = await page({ width: 1200, height: 520 })
  await p.locator('input[type=search]').fill('name:"Adam Smasher: Ender"')
  await p.waitForTimeout(450)
  await p.locator('.tile-art').first().click()
  await p.locator('.modal').waitFor()
  await checkStrip(p, '.modal', '.modal-scroll', 'modal en ventana baja de escritorio', isYellow)
  await ctx.close()
}

/* 3. lista de un desplegable largo (Facción tiene ~40 opciones) */
{
  const { p, ctx } = await page({ width: 1400, height: 900 })
  await p.getByRole('button', { name: 'Facción', exact: true }).click()
  await p.locator('.dd-list').waitFor()
  // en el desplegable el relleno son 6 px y la raya cian de la opción activa empieza ahí: se mide a 3 px del borde
  await checkStrip(p, '.dd-pop', '.dd-list', 'desplegable largo (Facción)', isCyan, 3)
  await noPseudoScroll(p, 'desplegable')
  await ctx.close()
}

/* 4. ayuda de búsqueda en móvil (panel largo con scroll) */
{
  const { p, ctx } = await page({ width: 390, height: 560 }, true)
  await p.getByRole('button', { name: 'Ayuda de sintaxis de búsqueda' }).or(p.locator('.searchhelp summary')).first().click()
  await p.locator('.searchhelp-body').waitFor()
  await checkStrip(p, '.searchhelp-body', '.searchhelp-scroll', 'ayuda de búsqueda en móvil', isYellow)
  await noPseudoScroll(p, 'ayuda de búsqueda')
  await ctx.close()
}

console.log(errors.length ? 'ERRORES: ' + [...new Set(errors)].join(' | ') : 'sin errores de página')
if (errors.length) failed++
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close()
process.exit(failed ? 1 : 0)

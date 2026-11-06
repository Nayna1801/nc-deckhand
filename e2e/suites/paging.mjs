import { chromium } from 'playwright'
import { BASE, CARDS } from '../config.mjs'
import { ALTS, N, P_TOTAL, pagesOf } from '../lib/data.mjs'
import { collect, goPage, pick, results } from '../lib/helpers.mjs'

let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
page.setDefaultTimeout(8000)
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => m.type() === 'error' && !/ERR_NO_BUFFER_SPACE|fonts\.g/.test(m.text()) && errors.push('console: ' + m.text()))

const tiles = () => page.locator('.tile')
const labels = () => page.locator('.tile-art').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
const info = () => page.locator('.pager-info').first().innerText()

await page.goto(BASE); await page.waitForSelector('.tile')

/* ---- primera página ---- */
ok((await tiles().count()) === 48 && (await results(page)) === N, `Cartas pinta 48 fichas de las ${N}`)
ok(new RegExp(`1–48 de ${N} cartas`).test(await info()), `el pie indica el tramo ("${await info()}")`)
ok((await page.locator('nav.pager').count()) === 2, 'hay paginación arriba y abajo de la lista')
ok((await page.locator('.pager-pages li').allInnerTexts()).slice(0, 4).join(',') === '1,2,3,4', 'páginas 1 a 4')
ok((await page.getByRole('button', { name: 'Página anterior' }).first().isDisabled()), '«Anterior» desactivado en la primera página')
ok((await page.locator('.pager [aria-current=page]').first().innerText()).trim() === '1', 'la página actual está marcada (aria-current)')

/* ---- navegar ---- */
const p1 = await labels()
await page.getByRole('button', { name: 'Página siguiente' }).last().click()
const p2 = await labels()
ok(p2.length === 48 && p2.every((l) => !p1.includes(l)), 'la página 2 trae otras 48 cartas, sin repetir')
ok(new RegExp(`49–96 de ${N}`).test(await info()), 'y el pie dice 49–96')
const top = await page.locator('.results-top').evaluate((el) => el.getBoundingClientRect().top)
ok(top >= 0 && top < 200, `al cambiar de página con el pie, la vista sube al inicio de la lista (${Math.round(top)}px)`)
const cardPages = pagesOf(N)
await goPage(page, cardPages.pages)
ok((await tiles().count()) === cardPages.last && new RegExp(`${N - cardPages.last + 1}–${N} de ${N}`).test(await info()), `la última página (${cardPages.pages}) tiene las ${cardPages.last} restantes`)
ok(await page.getByRole('button', { name: 'Página siguiente' }).first().isDisabled(), '«Siguiente» desactivado en la última')
const all = await collect(page, labels)
ok(all.length === N && new Set(all).size === N, `recorriendo las ${cardPages.pages} páginas salen las ${N} cartas una sola vez`)

/* ---- cambiar filtros vuelve a la primera página; pocas cartas = sin paginación ---- */
await goPage(page, 3)
await pick(page, 'Coste', '3')
ok((await results(page)) === 25 && (await tiles().count()) === 25, 'un filtro con 25 resultados los pinta todos')
ok((await page.locator('nav.pager').count()) === 0, 'sin paginación cuando todo cabe en una página')
await pick(page, 'Coste', '')
ok(new RegExp(`1–48 de ${N}`).test(await info()), 'al quitar el filtro se vuelve a la página 1')
await goPage(page, 3)
await pick(page, 'Color', 'Blue')
const blue = await results(page)
ok(blue > 0 && (await tiles().count()) === Math.min(48, blue), `cambiar de filtro desde la página 3 vuelve a la 1 y pinta ${Math.min(48, blue)} de ${blue} (no queda una página vacía)`)
await pick(page, 'Color', '')

/* ---- por impresión ---- */
await page.getByRole('button', { name: 'Por impresión' }).click()
ok((await results(page)) === P_TOTAL && (await tiles().count()) === 48, `por impresión: ${P_TOTAL} en total, 48 por página`)
const printPages = pagesOf(P_TOTAL)
await goPage(page, printPages.pages)
ok((await tiles().count()) === printPages.last && new RegExp(`${P_TOTAL - printPages.last + 1}–${P_TOTAL} de ${P_TOTAL} impresiones`).test(await info()), `última página de impresiones (${printPages.pages}): ${printPages.last}`)
await goPage(page, 1)
await page.getByRole('button', { name: 'Por carta' }).click()

/* ---- memoria: solo hay imágenes de la página y son miniaturas ---- */
await page.waitForFunction(() => [...document.querySelectorAll('.tile img')].slice(0, 8).every((i) => i.complete && i.naturalWidth > 0))
const imgs = await page.locator('.tile img').evaluateAll((els) => els.map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth })))
ok(imgs.length === 48, `solo hay 48 imágenes de ficha en la página, no ${N}`)
ok(imgs.every((i) => /\/cards\/t\//.test(i.src)), 'las fichas usan miniaturas (cards/t/…)')
const loaded = imgs.filter((i) => i.w > 0)
ok(loaded.length > 0 && loaded.every((i) => i.w <= 360), `las miniaturas miden 360 px o menos (${[...new Set(loaded.map((i) => i.w))].join(', ')})`)
await page.locator('.tile-art').first().click()
await page.locator('.modal').waitFor()
const modalSrc = await page.locator('.modal-img').getAttribute('src')
ok(!/\/cards\/t\//.test(modalSrc), 'el detalle usa la imagen completa')
await page.keyboard.press('Escape')

/* ---- si falta una miniatura se usa la completa ---- */
{
  const c2 = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await c2.route('**/cards/t/**', (r) => r.fulfill({ status: 404, body: '' }))
  const p2b = await c2.newPage()
  await p2b.goto(BASE); await p2b.waitForSelector('.tile')
  await p2b.waitForFunction(() => [...document.querySelectorAll('.tile img')].slice(0, 6).every((i) => i.complete && i.naturalWidth > 0))
  const srcs = await p2b.locator('.tile img').evaluateAll((els) => els.slice(0, 6).map((i) => i.getAttribute('src')))
  ok(srcs.every((s) => !/\/cards\/t\//.test(s)), 'sin miniaturas en el servidor, las fichas caen a la imagen completa y se ven')
  await c2.close()
}

/* ---- todas las imágenes tienen miniatura en el servidor ---- */
{
  const paths = [...new Set(CARDS.flatMap((c) => [c.image, ...c.altArts.map((a) => a.image).filter(Boolean)]))]
  const thumb = (p) => p.replace(/^cards\//, 'cards/t/')
  let bad = 0
  for (let i = 0; i < paths.length; i += 20) {
    const res = await Promise.all(paths.slice(i, i + 20).map((p) => ctx.request.get(new URL(thumb(p), BASE).href)))
    for (const r of res) if (r.status() !== 200 || !/image\/webp/.test(r.headers()['content-type'] ?? '')) bad++
  }
  ok(paths.length === N + ALTS && bad === 0, `las ${paths.length} imágenes tienen miniatura webp publicada (fallan ${bad})`)
}

/* ---- móvil ---- */
await page.setViewportSize({ width: 390, height: 800 })
await page.goto(BASE); await page.waitForSelector('.tile')
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
ok(overflow <= 1, `móvil: la paginación cabe sin scroll horizontal (${overflow}px)`)
await page.getByRole('button', { name: 'Página siguiente' }).last().click()
ok(/49–96/.test(await info()), 'móvil: se puede pasar de página')

ok(errors.length === 0, 'sin errores de página' + (errors.length ? ': ' + errors.join(' | ') : ''))
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close(); process.exit(failed ? 1 : 0)

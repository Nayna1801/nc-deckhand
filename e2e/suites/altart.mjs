import { chromium } from 'playwright'
import { BASE, CARDS, SHOTS } from '../config.mjs'
import fs from 'node:fs'

const shots = SHOTS
const cards = CARDS
let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const adam = cards.find((c) => c.id === 'adam_smasher_ender_of_legends')
const adamAlts = adam.altArts.filter((a) => a.image)
const plain = cards.find((c) => c.altArts.length === 0)
const errors = []

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
const p = await ctx.newPage(); p.setDefaultTimeout(8000)
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
p.on('console', (m) => { if (m.type() === 'error' || /content security policy/i.test(m.text())) errors.push('console: ' + m.text()) })
p.on('requestfailed', (r) => errors.push('reqfail ' + r.url()))

const open = async (c) => {
  const s = p.locator('input[type=search]')
  await s.fill(`name:"${c.displayName}"`); await p.waitForTimeout(450)
  await p.locator('.tile-art').first().click(); await p.locator('.modal').waitFor()
}
const close = async () => { await p.keyboard.press('Escape'); await p.locator('.modal').waitFor({ state: 'detached' }) }
const mainSrc = () => p.locator('.modal .modal-img').getAttribute('src')
const loaded = () => p.locator('.modal .modal-img').evaluate((i) => i.complete && i.naturalWidth > 0)

await p.goto(BASE); await p.waitForSelector('.tile')

/* ---- galería ---- */
await open(adam)
const thumbs = p.locator('.modal .thumbs .thumb')
ok((await thumbs.count()) === 1 + adamAlts.length && adamAlts.length >= 2, `${adam.displayName}: miniaturas = original + ${adamAlts.length} artes alternativos`)
ok((await thumbs.first().getAttribute('aria-pressed')) === 'true' && (await mainSrc()).endsWith(`cards/${adam.id}.webp`), 'al abrir se ve el arte original')
await thumbs.nth(1).click()
ok((await mainSrc()).includes('cards/alt/') && (await mainSrc()).endsWith('.webp'), `pulsar una miniatura cambia la imagen grande (${(await mainSrc()).split('/').pop()})`)
ok(await loaded(), 'la imagen alternativa carga de verdad')
ok((await thumbs.nth(1).getAttribute('aria-pressed')) === 'true' && (await thumbs.first().getAttribute('aria-pressed')) === 'false', 'la miniatura activa queda marcada (aria-pressed)')
const alt = await p.locator('.modal .modal-img').getAttribute('alt')
ok(/Adam Smasher/.test(alt) && alt.includes(' — '), `texto alternativo accesible: "${alt}"`)
await p.screenshot({ path: shots + '/h1-alt-desktop.png' })
// desde la lista de variantes
const rows = p.locator('.modal .variants .variant-row .link-btn')
ok((await rows.count()) === adamAlts.length, 'cada arte alternativo de la lista es un botón')
await rows.nth(adamAlts.length - 1).click()
ok((await thumbs.nth(adamAlts.length).getAttribute('aria-pressed')) === 'true' && (await loaded()), 'pulsar un arte en la lista lo muestra en grande')
ok((await p.locator('.modal .variant-row.active').count()) === 1, 'la fila activa se resalta')
// volver al original
await thumbs.first().click()
ok((await mainSrc()).endsWith(`cards/${adam.id}.webp`), 'la primera miniatura vuelve al original')
// teclado
await thumbs.nth(2).focus(); await p.keyboard.press('Enter')
ok((await thumbs.nth(2).getAttribute('aria-pressed')) === 'true', 'las miniaturas se manejan con el teclado (Enter)')
ok(await p.evaluate(() => !!document.activeElement?.closest('.modal')), 'el foco sigue dentro del modal')
// reabrir restablece
await close(); await open(adam)
ok((await mainSrc()).endsWith(`cards/${adam.id}.webp`) && (await thumbs.first().getAttribute('aria-pressed')) === 'true', 'al reabrir la carta vuelve a verse el original')
// otra carta no hereda el arte elegido
await thumbs.nth(1).click(); await close()
const other = cards.find((c) => c.id === 'dexter_deshawn_off_the_grid')
await open(other)
ok(!(await mainSrc()).includes('cards/alt/'), 'abrir otra carta no hereda el arte elegido')
await close()
// carta sin variantes
await open(plain)
ok((await p.locator('.modal .thumbs').count()) === 0, `carta sin artes alternativos ("${plain.displayName}"): no hay galería`)
await close()

/* ---- las 102 imágenes responden ---- */
const all = cards.flatMap((c) => c.altArts.map((a) => a.image))
const res = await p.evaluate(async (urls) => {
  const out = []
  for (let i = 0; i < urls.length; i += 12) {
    const batch = urls.slice(i, i + 12)
    out.push(...await Promise.all(batch.map(async (u) => { const r = await fetch(u); return { u, ok: r.ok, type: r.headers.get('content-type'), n: (await r.arrayBuffer()).byteLength } })))
  }
  return out
}, all)
ok(res.length === 102 && res.every((r) => r.ok && /image\/webp/.test(r.type || '') && r.n > 5000), `las ${res.length} imágenes de artes alternativos responden 200 como image/webp`)

/* ---- móvil ---- */
const mctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })
const m = await mctx.newPage(); m.setDefaultTimeout(8000)
m.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message))
await m.goto(BASE); await m.waitForSelector('.tile')
await m.locator('input[type=search]').fill(`name:"${adam.displayName}"`); await m.waitForTimeout(450)
await m.locator('.tile-art').first().click(); await m.locator('.modal').waitFor()
const box = await m.locator('.modal').boundingBox()
ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 800, `móvil: el detalle con galería cabe en pantalla (${Math.round(box.width)}x${Math.round(box.height)})`)
const tb = await m.locator('.modal .thumb').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right } }))
ok(tb.every((t) => t.l >= 0 && t.r <= 390), 'móvil: las miniaturas no se salen de la pantalla')
await m.locator('.modal .thumb').nth(1).tap()
ok((await m.locator('.modal .modal-img').getAttribute('src')).includes('cards/alt/'), 'móvil: tocar una miniatura cambia la imagen')
ok(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'móvil: sin scroll horizontal')
await m.screenshot({ path: shots + '/h2-alt-mobile.png' })
await mctx.close()

console.log(errors.length ? 'ERRORES: ' + [...new Set(errors)].join(' | ') : 'sin errores de consola, de red ni violaciones de CSP')
if (errors.length) failed++
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close(); process.exit(failed ? 1 : 0)

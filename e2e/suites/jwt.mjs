import { chromium } from 'playwright'
import { BASE } from '../config.mjs'
import { newSession } from '../lib/mock.mjs'

let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const browser = await chromium.launch()
const ID = 'saul_bright_stormrider'
const seed = (store) => store.collection.set(ID, { card_id: ID, quantity: 2, qty_foil: 0, qty_promo: 0, condition: 'mint', arts: {} })
const tileOf = (p) => p.locator('.tile', { has: p.locator('[aria-label^="Saul Bright: Stormrider"]') })
const alerts = (p) => p.locator('.banner[role=alert]').allInnerTexts()
async function open(opts) {
  const s = await newSession(browser, { legacy: false, ...opts })
  seed(s.store)
  const errors = []
  s.page.on('pageerror', (e) => errors.push(e.message))
  s.errors = errors
  await s.page.goto(BASE)
  await s.page.waitForSelector('.tile')
  await s.page.locator('input[type=search]').fill('name:"Saul Bright"')
  await s.page.waitForTimeout(450)
  return s
}

/* ---- carga: el servidor rechaza el token recién renovado una o dos veces ---- */
for (const n of [1, 2]) {
  const s = await open({ jwtFuture: n })
  await s.page.waitForFunction(() => document.querySelector('.tile-badge')?.textContent?.includes('×2'), null, { timeout: 12000 })
  ok(s.store.jwtRejected === n, `el servidor rechaza ${n === 1 ? 'la 1ª' : 'las 2 primeras'} petición(es) con «JWT issued at future» (${s.store.jwtRejected})`)
  ok((await alerts(s.page)).length === 0, `con ${n} rechazo(s) la app reintenta sola: no sale ningún aviso arriba`)
  ok(/×2/.test(await tileOf(s.page).locator('.tile-badge').innerText()), 'y tus datos se cargan igualmente (2 copias)')
  ok(s.errors.length === 0, 'sin errores de página')
  await s.ctx.close()
}

/* ---- guardar: el rechazo llega justo al pulsar + ---- */
{
  const s = await open({})
  await s.page.waitForFunction(() => document.querySelector('.tile-badge')?.textContent?.includes('×2'))
  s.store.jwtBlock = 1
  await tileOf(s.page).getByRole('button', { name: 'Añadir uno' }).click()
  await s.page.waitForFunction(() => document.querySelector('.tile-badge')?.textContent?.includes('×3'))
  await s.page.waitForTimeout(1800)
  ok(s.store.collection.get(ID)?.quantity === 3, `el guardado se reintenta y llega al servidor (quantity ${s.store.collection.get(ID)?.quantity})`)
  ok((await alerts(s.page)).length === 0, 'sin aviso de error al guardar')
  ok(/×3/.test(await tileOf(s.page).locator('.tile-badge').innerText()), 'y la pantalla mantiene las 3 copias')
  await s.ctx.close()
}

/* ---- si el servidor sigue rechazando: texto propio en español, sin el inglés del servidor ---- */
{
  const s = await open({ jwtFuture: 99 })
  await s.page.locator('.banner[role=alert]').waitFor({ timeout: 15000 })
  const [text] = await alerts(s.page)
  ok(/sesión se acaba de renovar/i.test(text) && !/JWT|future/i.test(text), `el aviso va en español y sin el texto técnico ("${text.replace(/\s+/g, ' ')}")`)
  ok(s.store.jwtTotal > 3, `antes de rendirse se reintentó (${s.store.jwtTotal} peticiones rechazadas)`)
  await s.page.getByRole('button', { name: 'Cerrar' }).click()
  ok((await alerts(s.page)).length === 0, 'y el aviso se puede cerrar')
  await s.ctx.close()
}

{
  const s = await open({})
  await s.page.waitForFunction(() => document.querySelector('.tile-badge')?.textContent?.includes('×2'))
  s.store.jwtBlock = 99
  await tileOf(s.page).getByRole('button', { name: 'Añadir uno' }).click()
  await s.page.locator('.banner[role=alert]').waitFor({ timeout: 15000 })
  const [text] = await alerts(s.page)
  ok(/sesión se acaba de renovar/i.test(text) && !/JWT|future/i.test(text), 'al guardar con el servidor rechazando: aviso en español')
  await s.page.waitForFunction(() => document.querySelector('.tile-badge')?.textContent?.includes('×2'), null, { timeout: 5000 })
  ok(s.store.collection.get(ID)?.quantity === 2, 'y la pantalla vuelve a lo guardado de verdad (2 copias), sin fingir que se guardó')
  await s.ctx.close()
}

await browser.close()
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
process.exit(failed ? 1 : 0)

import { chromium } from 'playwright'
import { BASE, CARDS } from '../config.mjs'
import { newSession } from '../lib/mock.mjs'

let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const browser = await chromium.launch()
const USER = '00000000-0000-4000-8000-000000000001'
const OWNED = CARDS.slice(0, 12)
const seed = (store) => OWNED.forEach((c) => store.collection.set(c.id, { card_id: c.id, quantity: 1, qty_foil: 0, qty_promo: 0, condition: 'mint', arts: {} }))
const sync = (p) => p.locator('.album-sync').getAttribute('data-sync')
const labels = (p) => p.locator('.album-page:not(.blank) .pocket').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
const wide = { viewport: { width: 900, height: 900 } }

async function open(p) {
  p.on('dialog', (d) => d.accept())
  await p.goto(BASE + '#/collection')
  await p.waitForSelector('.album')
  await p.waitForFunction(() => ['synced', 'missing', 'error'].includes(document.querySelector('.album-sync')?.getAttribute('data-sync') ?? ''))
}

async function fillAlbum(p) {
  await p.getByRole('button', { name: /Editar álbum/ }).click()
  await p.locator('.album-fill summary').click()
  await p.locator('.album-fill').getByRole('button', { name: 'Mis cartas', exact: true }).click()
  await p.locator('.album-fill').getByRole('button', { name: /^Rellenar/ }).click()
}

/* ---- el álbum se sube a la cuenta y se ve en otro dispositivo ---- */
{
  const a = await newSession(browser, { legacy: false, context: wide })
  seed(a.store)
  await open(a.page)
  ok((await sync(a.page)) === 'synced' && /sincronizado con tu cuenta/i.test(await a.page.locator('.album-sync').innerText()), 'con sesión y tabla disponible, el álbum se indica como sincronizado con la cuenta')
  ok(a.store.album.size === 0, 'un álbum vacío y sin tocar no se sube')
  await fillAlbum(a.page)
  await a.page.waitForFunction(() => document.querySelector('.album-sync')?.getAttribute('data-sync') === 'synced')
  await a.page.waitForTimeout(1200)
  const row = a.store.album.get(USER)
  ok(!!row && row.data.slots.filter(Boolean).length === OWNED.length, `el álbum rellenado se guarda en la cuenta (${row?.data?.slots?.filter(Boolean).length} cartas)`)
  ok(row?.data?.updatedAt > 0 && !!row?.updated_at, 'con su marca de tiempo')
  const writes = a.store.writes.filter((w) => w.table === 'tcg_album').length
  // varios cambios seguidos = una sola subida (espera tras el último)
  await a.page.locator('.pocket').nth(0).click(); await a.page.locator('.pocket').nth(1).click()
  await a.page.locator('.pocket').nth(2).click(); await a.page.locator('.pocket').nth(3).click()
  await a.page.locator('.pocket').nth(4).click(); await a.page.locator('.pocket').nth(5).click()
  await a.page.waitForTimeout(1600)
  ok(a.store.writes.filter((w) => w.table === 'tcg_album').length === writes + 1, 'una racha de cambios seguidos hace una sola subida')
  const shownIds = (await labels(a.page)).map((x) => CARDS.find((c) => x === c.displayName)?.id)
  ok(JSON.stringify(a.store.album.get(USER).data.slots.slice(0, 9).map((x) => x?.card)) === JSON.stringify(shownIds), 'y lo subido coincide con lo que se ve (primera página)')
  const first = await labels(a.page)

  // otro dispositivo: navegador sin nada guardado, misma cuenta
  const b = await newSession(browser, { legacy: false, context: wide })
  seed(b.store)
  b.store.album = a.store.album
  await open(b.page)
  ok(JSON.stringify(await labels(b.page)) === JSON.stringify(first), 'en otro dispositivo con la misma cuenta aparece el mismo álbum, en el mismo orden')
  ok(/12 cartas/.test(await b.page.locator('.album-count').innerText()), 'con sus cartas y páginas')

  // el segundo dispositivo cambia algo y el primero lo recibe al volver a entrar
  await b.page.getByRole('button', { name: /Editar álbum/ }).click()
  await b.page.locator('.pocket').nth(0).click(); await b.page.locator('.pocket').nth(2).click()
  await b.page.waitForTimeout(1600)
  const second = await labels(b.page)
  ok(JSON.stringify(second) !== JSON.stringify(first), 'el segundo dispositivo hace un cambio (mover una carta)')
  await a.page.reload(); await a.page.waitForSelector('.album')
  await a.page.waitForFunction(() => document.querySelector('.album-sync')?.getAttribute('data-sync') === 'synced')
  ok(JSON.stringify(await labels(a.page)) === JSON.stringify(second), 'al recargar en el primero llega el cambio más reciente (gana la copia más nueva)')
  ok(a.errors.length === 0 && b.errors.length === 0, 'sin errores de página')
}

/* ---- un álbum solo local (de antes de sincronizar) sube a la cuenta si esta no tiene ninguno ---- */
{
  const a = await newSession(browser, { legacy: false, context: wide })
  seed(a.store)
  a.store.albumDown = true // la cuenta no responde: se trabaja en local
  await open(a.page)
  ok((await sync(a.page)) === 'error', 'si la cuenta no responde se avisa del error (el álbum sigue en el navegador)')
  ok(/Reintentar/i.test(await a.page.locator('.album-sync').innerText()) && !/Failed to fetch/i.test(await a.page.locator('.album-sync').innerText()), 'con un mensaje propio en español y botón Reintentar')
  await fillAlbum(a.page)
  ok(/12 cartas/.test(await a.page.locator('.album-count').innerText()), 'se puede seguir editando sin conexión con la cuenta')
  a.store.albumDown = false
  await a.page.getByRole('button', { name: 'Reintentar' }).click()
  await a.page.waitForFunction(() => document.querySelector('.album-sync')?.getAttribute('data-sync') === 'synced')
  await a.page.waitForTimeout(300)
  ok(a.store.album.get(USER)?.data?.slots?.filter(Boolean).length === 12, 'al reintentar, el álbum hecho en local se sube a la cuenta')
}

/* ---- sin la tabla (no se ha vuelto a ejecutar schema.sql) ---- */
{
  const a = await newSession(browser, { legacy: false, noAlbum: true, context: wide })
  seed(a.store)
  await open(a.page)
  ok((await sync(a.page)) === 'missing' && /schema\.sql/.test(await a.page.locator('.album-sync').innerText()), 'sin la tabla explica que hay que volver a ejecutar schema.sql')
  await fillAlbum(a.page)
  ok(/12 cartas/.test(await a.page.locator('.album-count').innerText()), 'y el álbum funciona igual en el navegador')
  await a.page.reload(); await a.page.waitForSelector('.album')
  ok(/12 cartas/.test(await a.page.locator('.album-count').innerText()), 'y se conserva al recargar')
  ok(a.errors.length === 0, 'sin errores de página')
}

/* ---- la copia más antigua nunca pisa a la más nueva ---- */
{
  const a = await newSession(browser, { legacy: false, context: wide })
  seed(a.store)
  a.store.album.set(USER, { user_id: USER, data: { name: 'De la cuenta', perPage: 4, updatedAt: 1000, slots: [{ card: OWNED[3].id }] }, updated_at: new Date(1000).toISOString() })
  // este navegador tiene un álbum más reciente
  await a.ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`ncd.album.v1.${USER}`, JSON.stringify({ name: 'Local nuevo', perPage: 9, updatedAt: Date.now(), slots: [{ card: OWNED[5].id }, { card: OWNED[6].id }] })])
  await open(a.page)
  await a.page.waitForTimeout(500)
  ok((await a.page.locator('.album-count').innerText()).includes('2 cartas') && (await a.page.locator('.album-title').innerText()) === 'Local nuevo', 'si el del navegador es más reciente, gana')
  ok(a.store.album.get(USER)?.data?.name === 'Local nuevo', 'y se sube a la cuenta')
  const c = await newSession(browser, { legacy: false, context: wide })
  seed(c.store)
  c.store.album.set(USER, { user_id: USER, data: { name: 'Cuenta nueva', perPage: 4, updatedAt: Date.now() + 5000, slots: [{ card: OWNED[3].id }] }, updated_at: new Date().toISOString() })
  await c.ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`ncd.album.v1.${USER}`, JSON.stringify({ name: 'Local viejo', perPage: 9, updatedAt: 5000, slots: [{ card: OWNED[5].id }] })])
  await open(c.page)
  ok((await c.page.locator('.album-title').innerText()) === 'Cuenta nueva' && (await c.page.locator('.album-count').innerText()).includes('1 carta'), 'si el de la cuenta es más reciente, gana y sustituye al del navegador')
  ok(c.store.album.get(USER)?.data?.name === 'Cuenta nueva', 'sin pisarlo en la cuenta')
}

/* ---- datos de la cuenta manipulados ---- */
{
  const a = await newSession(browser, { legacy: false, context: wide })
  seed(a.store)
  a.store.album.set(USER, { user_id: USER, data: { name: '<img src=x onerror=alert(1)>', perPage: 99, updatedAt: 10, slots: [{ card: '__proto__' }, { card: 'no_existe' }, { card: OWNED[0].id, print: 'basura' }, 5, null] }, updated_at: new Date().toISOString() })
  await open(a.page)
  ok((await a.page.locator('.album-count').innerText()).includes('1 carta'), 'cartas inexistentes o mal formadas en la cuenta se descartan')
  ok((await a.page.locator('.album-title').innerText()).startsWith('<img') && (await a.page.locator('.album-title img').count()) === 0, 'el nombre se muestra como texto, nunca como HTML')
  ok(a.errors.length === 0, 'sin errores de página')
}

/* ---- sin sesión (invitado) no hay sincronización: la pestaña ni existe ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } })
  const p = await ctx.newPage()
  await p.goto(BASE + '#/collection')
  await p.waitForTimeout(500)
  ok((await p.locator('.album').count()) === 0 && /necesitas una cuenta/i.test(await p.locator('body').innerText()), 'sin sesión la Colección pide iniciar sesión (no hay álbum que sincronizar)')
  await ctx.close()
}

await browser.close()
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
process.exit(failed ? 1 : 0)

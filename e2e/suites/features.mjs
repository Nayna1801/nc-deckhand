import { chromium } from 'playwright'
import { BASE, CARDS, DECKS, SHOTS } from '../config.mjs'
import fs from 'node:fs'
import zlib from 'node:zlib'
import { collect, findOnPages, pick, results, shown, until } from '../lib/helpers.mjs'
import { newSession } from '../lib/mock.mjs'
import { N, count as dataCount } from '../lib/data.mjs'

const shots = SHOTS
const decks = DECKS
const realDeckText = decks[3].text
const cards = CARDS
let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }
const names = (page) => page.locator('.tile-art').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))

const SETS = ['welcometonightcityretail', 'embracingpowerretailstarterdeck', 'theheistretailstarterdeck']
const idx = (c) => { const i = SETS.indexOf(c.setCode); return i < 0 ? SETS.length : i }
const num = (c) => parseInt(c.importId, 10) || 0
const bySet = (a, b) => idx(a) - idx(b) || a.setCode.localeCompare(b.setCode) || num(a) - num(b) || a.displayName.localeCompare(b.displayName)
const kw = (c, k) => new RegExp('\\{' + k + '\\}', 'i').test(c.rules)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await ctx.newPage()
page.setDefaultTimeout(8000)
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error' || /content security policy/i.test(m.text())) errors.push('console: ' + m.text()) })

/* ================= orden y divisiones por set ================= */
await page.goto(BASE); await page.waitForSelector('.tile')
const heads = [...new Set(await collect(page, (pg) => pg.locator('.set-head span').allInnerTexts()))]
ok(heads.length === 4 && /welcome to night city/i.test(heads[0]) && /embracing power/i.test(heads[1]) && /the heist/i.test(heads[2]) && /set 1 promos/i.test(heads[3]), `4 bloques por set con encabezado: ${heads.join(' | ')}`)
ok(/^140 cartas$/.test((await page.locator('.set-head small').first().innerText()).trim()), 'el encabezado cuenta todo el grupo (140) aunque la página solo muestre parte')
const expectedSet = [...cards].sort(bySet).map((c) => c.displayName)
const got = await collect(page, names)
ok(JSON.stringify(got) === JSON.stringify(expectedSet), 'el orden por defecto es por set y, dentro, por número de coleccionista (todas las cartas, exactas)')
const groupOf = (n) => page.locator('.setgroup', { has: page.locator(`.tile-art[aria-label="${n}"]`) }).locator('.set-head span').innerText()
await findOnPages(page, '.tile-art[aria-label="Yorinobu Arasaka: Embracing Destruction"]')
const gy = await groupOf('Yorinobu Arasaka: Embracing Destruction')
await findOnPages(page, '.tile-art[aria-label="Viktor Vektor: Sit Down and Relax"]')
const gv = await groupOf('Viktor Vektor: Sit Down and Relax')
ok(gy !== gv && /embracing/i.test(gy) && /heist/i.test(gv), `Yorinobu y Viktor (ambos nº1) están en bloques distintos con su cabecera: "${gy}" / "${gv}"`)
await page.screenshot({ path: shots + '/f1-sets.png' })
await pick(page, 'Orden', 'cost')
ok((await page.locator('.set-head').count()) === 0, 'ordenar por coste quita las divisiones por set')
const expectedCost = [...cards].sort((a, b) => (a.cost ?? 99) - (b.cost ?? 99) || a.displayName.localeCompare(b.displayName)).map((c) => c.displayName)
ok(JSON.stringify(await collect(page, names)) === JSON.stringify(expectedCost), 'orden por coste correcto (150 cartas exactas)')
await pick(page, 'Orden', 'set')

/* ================= filtros de keyword, efecto y poder ================= */
await pick(page, 'Keyword', 'blocker')
const eb = cards.filter((c) => kw(c, 'blocker')).length
ok((await results(page)) === eb && eb > 0, `Keyword Blocker -> ${eb}`)
await pick(page, 'Keyword', '')
await pick(page, 'Keyword', 'gosolo')
ok((await results(page)) === cards.filter((c) => kw(c, 'go solo')).length, 'Keyword Go Solo')
await pick(page, 'Keyword', '')
await pick(page, 'Efecto', 'spend')
ok((await results(page)) === cards.filter((c) => kw(c, 'spend')).length, 'Efecto Spend')
await pick(page, 'Efecto', '')
for (const [v, f] of [['u5', (p) => p < 5], ['5-9', (p) => p >= 5 && p <= 9], ['10+', (p) => p >= 10]]) {
  await pick(page, 'Poder', v)
  const e = cards.filter((c) => c.power != null && f(c.power)).length
  ok((await results(page)) === e && e > 0, `Poder ${v} -> ${e}`)
  await pick(page, 'Poder', '') // Poder admite varias opciones: se vacía antes de probar la siguiente
}
await pick(page, 'Poder', '')
await pick(page, 'Keyword', 'blocker'); await pick(page, 'Poder', '5-9')
const comb = cards.filter((c) => kw(c, 'blocker') && c.power != null && c.power >= 5 && c.power <= 9).length
ok((await results(page)) === comb, `filtros combinados Blocker + Poder 5-9 -> ${comb}`)
await page.getByRole('button', { name: 'Limpiar' }).click()
ok((await results(page)) === N, 'Limpiar restablece todos los filtros')

/* ================= desplegable: teclado ================= */
// Keyword es un desplegable de selección única (los de varias opciones se prueban en la suite multifilter)
const tipo = page.getByRole('button', { name: 'Keyword', exact: true })
await page.mouse.move(5, 5) // el ratón sobre la lista cambiaría la opción activa
await tipo.focus(); await page.keyboard.press('ArrowDown')
ok((await page.locator('.dd-list').count()) === 1, 'ArrowDown abre el desplegable')
const activeIs = (text) => page.waitForFunction((t) => document.querySelector('.dd-opt.active')?.textContent === t, text)
await activeIs('Todos') // la lista ya tiene el foco y la opción inicial pintada
await page.keyboard.press('ArrowDown'); await activeIs('Blocker'); await page.keyboard.press('Enter')
ok((await results(page)) === cards.filter((c) => kw(c, 'blocker')).length && (await shown(page, 'Keyword')) === 'Blocker', 'flechas + Enter eligen "Blocker" (' + (await results(page)) + ', ' + (await shown(page, 'Keyword')) + ')')
ok(await tipo.evaluate((el) => el === document.activeElement), 'el foco vuelve al botón tras elegir')
await tipo.click(); await page.keyboard.type('a'); await page.keyboard.press('Enter')
ok((await shown(page, 'Keyword')) === 'Adrenaline', 'escribir una letra salta a la opción ("a" -> Adrenaline)')
await tipo.click(); await page.keyboard.press('Escape')
ok((await page.locator('.dd-list').count()) === 0 && (await shown(page, 'Keyword')) === 'Adrenaline', 'Escape cierra sin cambiar el valor')
await tipo.click(); await page.mouse.click(5, 300)
ok((await page.locator('.dd-list').count()) === 0, 'clic fuera cierra el desplegable')
await page.getByRole('button', { name: 'Limpiar' }).click()

/* ================= debounce del buscador ================= */
const search = page.locator('input[type=search]')
await search.click(); await search.pressSequentially('saul', { delay: 40 })
const immediate = await results(page)
ok(immediate === N, `debounce: justo tras teclear aún no se recalcula la lista (${immediate})`)
await page.waitForFunction(() => document.querySelectorAll('.tile').length === 1)
ok(true, 'debounce: ~250 ms después la lista se filtra a 1 carta')
await search.fill('')

/* ================= mazo real: bloqueo centrado, colores y tarjetas ================= */
await page.goto(BASE + '#/decks'); await page.getByRole('button', { name: 'Importar texto' }).click()
await page.fill('textarea', realDeckText); await page.getByRole('button', { name: 'Crear mazo' }).click()
await page.waitForURL(/#\/decks\/.+/); await page.waitForSelector('.legend-slots')
const lockTile = page.locator('.tile.locked').first()
await lockTile.scrollIntoViewIfNeeded()
const tr = await lockTile.locator('.tile-art').boundingBox(), lr = await lockTile.locator('.tile-lockbox').boundingBox()
const cx = lr.x + lr.width / 2 - (tr.x + tr.width / 2), cy = lr.y + lr.height / 2 - (tr.y + tr.height / 2)
ok(Math.abs(cx) < tr.width * 0.12 && Math.abs(cy) < tr.height * 0.12, `el aviso de bloqueo está centrado en la carta (desvío ${Math.round(cx)}px, ${Math.round(cy)}px)`)
ok(lr.y > tr.y + tr.height * 0.25, 'el aviso no tapa la zona del coste (esquina superior)')
ok(/bloqueada/i.test(await lockTile.locator('.tile-lockbox').innerText()), 'el aviso dice "BLOQUEADA"')
await page.screenshot({ path: shots + '/f2-lock.png' })

const legends = decks[3].text.split(/\r?\n/).filter((l) => /^1x /.test(l)).slice(0, 3)
const legendCards = legends.map((l) => cards.find((c) => c.type === 'Legend' && l.includes(c.displayName)))
const counts = {}; legendCards.forEach((c) => (counts[c.color] = (counts[c.color] || 0) + 1))
const canon = ['Red', 'Yellow', 'Blue', 'Green']
const expLetters = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || canon.indexOf(a) - canon.indexOf(b)).flatMap((c) => Array(counts[c]).fill(c[0])).join('')
const editorCode = (await page.locator('.deck-id .cc').allInnerTexts()).join('')
ok(editorCode === expLetters, `código de colores en el editor: ${editorCode} (esperado ${expLetters})`)

await page.goto(BASE + '#/decks'); await page.waitForSelector('.deck-card')
const card = page.locator('.deck-card').first()
ok((await card.locator('.cc').allInnerTexts()).join('') === expLetters, `tarjeta de mazo muestra ${expLetters} destacado`)
ok(/ · /.test(await card.locator('.cc-names').innerText()), 'y los nombres completos debajo (' + (await card.locator('.cc-names').innerText()).replace(/\n/g, ' ') + ')')
const imgs = await card.locator('.deck-legends3 img').evaluateAll((els) => els.map((i) => ({ w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height, ok: i.naturalWidth > 0 })))
ok(imgs.length === 3 && imgs.every((i) => i.ok && Math.abs(i.w / i.h - 5 / 7) < 0.06 && i.w > 80), `las 3 Legends se ven completas, sin recorte y grandes (${imgs.map((i) => Math.round(i.w) + 'x' + Math.round(i.h)).join(', ')})`)
const overflow = await card.evaluate((el) => [el, ...el.querySelectorAll('*')].filter((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow === 'visible' && n.clientWidth > 0 && n.getBoundingClientRect().right > el.getBoundingClientRect().right + 1).length)
ok(overflow === 0, 'ningún texto sobresale de la tarjeta')
await card.getByRole('button', { name: 'Copiar lista' }).click()
const clip = await page.evaluate(() => navigator.clipboard.readText())
ok(/^# Name:/.test(clip) && /# Legends/.test(clip) && /# Main Deck/.test(clip), 'Copiar lista deja el mazo en el portapapeles (formato del sim)')
ok(/copiada/i.test(await card.locator('.deck-msg').innerText()), 'confirmación "Lista copiada"')
const [dl] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Exportar .txt' }).click()])
ok(/# Main Deck/.test(fs.readFileSync(await dl.path(), 'utf8')) && dl.suggestedFilename().endsWith('.txt'), `Exportar .txt descarga ${dl.suggestedFilename()}`)
await page.screenshot({ path: shots + '/f3-deckcards.png' })

/* ================= seguridad en la interfaz ================= */
const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
ok(/script-src 'self'/.test(csp) && /object-src 'none'/.test(csp) && !/unsafe-eval/.test(csp), 'CSP presente: scripts solo propios, sin eval, sin object')
// 1) datos manipulados en localStorage
const tamper = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
await tamper.addInitScript(() => {
  localStorage.setItem('ncd.guestDecks.v1', '[{"id":"<script>x</script>","name":"<img src=x onerror=window.__pwn=1>","legendIds":["constructor","goro_takemura_hands_unclean"],"main":{"__proto__":{"polluted":1},"saul_bright_stormrider":9999,"inventada":3},"side":"roto"},"basura",null]')
})
const tp = await tamper.newPage(); tp.setDefaultTimeout(8000)
const tperrs = []; tp.on('pageerror', (e) => tperrs.push(e.message))
await tp.goto(BASE + '#/decks'); await tp.waitForSelector('.deck-card')
ok((await tp.locator('.deck-card').count()) === 1, 'localStorage manipulado: solo sobrevive el mazo válido (descarta "basura" y null)')
ok(/<img src=x onerror/.test(await tp.locator('.deck-card h3').innerText()) && (await tp.locator('.deck-card img[onerror]').count()) === 0, 'un nombre con HTML se muestra como texto, no se ejecuta')
ok((await tp.evaluate(() => window.__pwn)) === undefined && (await tp.evaluate(() => ({}).polluted)) === undefined, 'sin XSS ni contaminación de prototipo')
ok(tperrs.length === 0, 'la página no falla con datos corruptos')
await tamper.close()
// 2) importar una cantidad absurda en Legends
await page.getByRole('button', { name: 'Importar texto' }).click()
await page.fill('textarea', '# Legends\n999999999x 012 Goro Takemura: Hands Unclean')
const t0 = Date.now()
await page.getByRole('button', { name: 'Crear mazo' }).click(); await page.waitForURL(/#\/decks\/.+/)
ok(Date.now() - t0 < 3000 && (await page.locator('.slot.filled').count()) <= 3, `importar "999999999x" no congela la página (${Date.now() - t0} ms)`)
// 3) bomba de descompresión en un enlace compartido
const bomb = 'ncd1.' + zlib.deflateRawSync(Buffer.alloc(4 * 1024 * 1024)).toString('base64url')
const t1 = Date.now()
await page.goto(BASE + '#/share/' + bomb)
await page.getByRole('heading', { name: 'Código no válido' }).waitFor()
ok(Date.now() - t1 < 3000, `enlace-bomba rechazado en ${Date.now() - t1} ms`)

/* ================= móvil ================= */
const mctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, permissions: ['clipboard-read', 'clipboard-write'] })
const m = await mctx.newPage(); m.setDefaultTimeout(8000)
m.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message))
const noOverflow = async (label) => ok(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `móvil sin scroll horizontal: ${label}`)
await m.goto(BASE); await m.waitForSelector('.tile')
ok((await m.locator('.fadv').isVisible()) === false, 'móvil: los filtros avanzados están plegados')
await noOverflow('Cartas (galería)')
const t = await m.locator('.tile').evaluateAll((els) => els.slice(0, 3).map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) } }))
ok(t[0].y === t[1].y && t[2].y > t[0].y && t[1].x > t[0].x, 'móvil: la galería es de 2 columnas')
ok((await m.evaluate(() => getComputedStyle(document.querySelector('.topbar')).position)) !== 'sticky', 'móvil: la barra superior no ocupa pantalla fija')
await m.getByRole('button', { name: /Filtros/ }).click()
ok(await m.locator('.fadv').isVisible(), 'móvil: el botón "Filtros" los despliega')
await m.getByRole('button', { name: 'Tipo', exact: true }).click()
const pr = await m.locator('.dd-pop').boundingBox()
ok(pr.x >= 0 && pr.x + pr.width <= 390 && pr.y >= 0 && pr.y + pr.height <= 800, `móvil: el desplegable cabe en pantalla (${Math.round(pr.width)}x${Math.round(pr.height)})`)
await m.locator('.dd-list [role=option][data-value="Legend"]').click()
ok((await results(m)) === dataCount((c) => c.type === 'Legend'), `móvil: elegir en el desplegable filtra (${dataCount((c) => c.type === 'Legend')} Legends)`)
await noOverflow('Cartas con filtros abiertos')
await m.getByRole('button', { name: 'Limpiar' }).click()
await m.locator('.tile-art').first().click(); await m.locator('.modal').waitFor()
const mr = await m.locator('.modal').boundingBox()
ok(mr.x >= 0 && mr.x + mr.width <= 390 && mr.y >= 0 && mr.y + mr.height <= 800, `móvil: el detalle de carta cabe en pantalla (${Math.round(mr.width)}x${Math.round(mr.height)})`)
await noOverflow('detalle de carta')
await m.screenshot({ path: shots + '/f4-mobile-modal.png' })
await m.keyboard.press('Escape')
await m.getByRole('button', { name: /Lista/ }).click(); await noOverflow('Cartas (lista)'); await m.getByRole('button', { name: /Galería/ }).click()
await m.goto(BASE + '#/decks'); await m.getByRole('button', { name: 'Importar texto' }).click()
await m.fill('textarea', realDeckText); await m.getByRole('button', { name: 'Crear mazo' }).click(); await m.waitForURL(/#\/decks\/.+/)
await m.locator('.editor-cards').waitFor()
ok(await m.locator('.pane-switch').isVisible(), 'móvil: el constructor tiene selector Catálogo / Mazo')
ok(!(await m.locator('.editor-deck').isVisible()) && (await m.locator('.editor-cards').isVisible()), 'móvil: empieza en el catálogo')
await noOverflow('constructor (catálogo)'); await m.screenshot({ path: shots + '/f5-mobile-editor.png' })
await m.getByRole('tab', { name: /Mazo/ }).click()
ok((await m.locator('.editor-deck').isVisible()) && !(await m.locator('.editor-cards').isVisible()), 'móvil: el selector cambia al panel del mazo')
await noOverflow('constructor (mazo)'); await m.screenshot({ path: shots + '/f6-mobile-deck.png' })
await m.goto(BASE + '#/decks'); await m.waitForSelector('.deck-card'); await noOverflow('lista de mazos')
await m.screenshot({ path: shots + '/f7-mobile-decks.png' })
await m.goto(BASE + '#/login'); await noOverflow('login')
await mctx.close()

/* ================= con sesión: URL, deseos, playset ================= */
{
  const s = await newSession(browser, { legacy: false })
  const p = s.page
  await p.goto(BASE + '?x#/?owned=missing'); await p.waitForSelector('.tile')
  ok((await shown(p, 'Colección')) === 'Las que me faltan', 'con sesión: /?owned=missing abre el filtro "me faltan"')
  await p.getByRole('link', { name: 'Cartas', exact: true }).click()
  await p.waitForFunction(() => !location.hash.includes('owned'))
  ok((await until(() => shown(p, 'Colección'), 'Todas')) === 'Todas', 'pulsar "Cartas" en la barra vuelve al filtro "Todas" (punto 1)')

  const first = p.locator('.tile').first()
  const heart = first.locator('.heart')
  ok((await heart.getAttribute('aria-pressed')) === 'false', 'cada carta tiene su ♡ de deseos')
  await heart.click(); await p.waitForTimeout(250)
  ok((await first.locator('.heart').getAttribute('aria-pressed')) === 'true' && s.store.wishlist.size === 1, 'pulsar ♡ la marca y la guarda en tcg_wishlist')
  const wid = [...s.store.wishlist.keys()][0]
  await p.locator('.tile-art').first().click()
  const modal = p.locator('.modal'); await modal.waitFor()
  ok(/lista de deseos/i.test(await modal.innerText()), 'el detalle de la carta tiene su sección de deseos')
  await modal.locator('.wish').getByRole('button', { name: 'Añadir uno' }).click(); await p.waitForTimeout(250)
  ok(s.store.wishlist.get(wid)?.quantity === 2, 'se pueden querer varias copias (×2)')
  await modal.locator('.inventory .row', { hasText: 'Normal' }).getByRole('button', { name: 'Añadir uno' }).click(); await p.waitForTimeout(250)
  const mt = await modal.innerText()
  ok(/playset: 1 de 1 copia/i.test(mt) && /playset completo/i.test(mt), 'Legend con 1 copia: "Playset: 1 de 1 copia" y playset completo')
  ok(!/colecci.n activa/i.test(mt), 'ya no aparece el confuso "Colección activa"')
  await p.keyboard.press('Escape')
  await p.goto(BASE + '#/collection'); await p.waitForSelector('.stats-row')
  await p.getByRole('tab', { name: /Mis deseos/ }).click()
  ok(/\(1\)/.test(await p.getByRole('tab', { name: /Mis deseos/ }).innerText()) && (await p.locator('.panel .deck-row').count()) === 1, 'la pestaña "Mis deseos (1)" lista la carta')
  const [d1] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Exportar CSV' }).click()])
  const csv = fs.readFileSync(await d1.path(), 'utf8')
  ok(csv.startsWith('code,name,set,rarity,wanted,owned') && /,2,1$/m.test(csv), 'deseos.csv con cantidad deseada y poseída')
  await p.goto(BASE + '#/'); await p.waitForSelector('.tile')
  await pick(p, 'Colección', 'wanted')
  ok((await results(p)) === 1, 'filtro "Las que deseo" -> 1 carta')
  await p.locator('.tile').first().locator('.heart').click(); await p.waitForTimeout(250)
  ok((await results(p)) === 1 && s.store.wishlist.size === 0, 'al quitar el ♥ con ese filtro, la carta no desaparece de golpe')
  await pick(p, 'Colección', 'all'); await pick(p, 'Colección', 'wanted')
  ok((await results(p)) === 0, 'al re-aplicar el filtro, ya no está')
  ok(s.errors.length === 0, 'con sesión: sin errores de página')
}

/* ================= sin tabla de deseos (SQL sin re-ejecutar) ================= */
{
  const s = await newSession(browser, { legacy: false, noWishlist: true })
  const p = s.page
  await p.goto(BASE); await p.waitForSelector('.tile')
  // los datos se cargan después de pintar las cartas: hay que esperar a que terminen para saber que no existe la tabla
  await p.waitForFunction(() => !document.querySelector('.stepper[title*="Cargando"]'))
  ok((await p.locator('.heart').count()) === 0, 'sin tabla de deseos: no se muestran corazones')
  ok((await p.locator('.banner').count()) === 0, 'sin tabla de deseos: no se enseña ningún error')
  await p.locator('.tile-art').first().click()
  ok(/schema\.sql/.test(await p.locator('.modal').innerText()), 'sin tabla de deseos: el detalle explica que hay que re-ejecutar schema.sql')
}

console.log(errors.length ? 'ERRORES DE CONSOLA/PÁGINA:\n' + [...new Set(errors)].join('\n') : 'sin errores de consola ni violaciones de CSP')
if (errors.length) failed++
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close(); process.exit(failed ? 1 : 0)

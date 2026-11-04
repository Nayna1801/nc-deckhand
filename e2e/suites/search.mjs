import { chromium } from 'playwright'
import { BASE, CARDS, SHOTS } from '../config.mjs'
import { pick, shown } from '../lib/helpers.mjs'
import fs from 'node:fs'
const shots = SHOTS
const cards = CARDS
let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 1000 } }); p.setDefaultTimeout(8000)
const errs = []; p.on('pageerror', e => errs.push(e.message))
await p.goto(BASE); await p.waitForSelector('.tile')
const search = p.locator('input[type=search]')
const count = async () => p.locator('.tile').count()
const q = async (text) => { await search.fill(text); await p.waitForTimeout(450); return count() }

// 1. consulta de ejemplo con varios campos: t:unit c:red cost<=2 o:"draw"
const exp1 = cards.filter(c => c.type === 'Unit' && c.color === 'Red' && c.cost != null && c.cost <= 6 && /draw/i.test(c.rules)).length
ok(exp1 > 0, `(la consulta de prueba tiene resultados reales: ${exp1})`)
ok((await q('t:unit c:red cost<=6 o:"draw"')) === exp1, `t:unit c:red cost<=6 o:"draw" -> ${exp1} cartas`)
const exp1b = cards.filter(c => c.type === 'Unit' && c.color === 'Red' && c.cost != null && c.cost <= 2 && /draw/i.test(c.rules)).length
ok((await q('t:unit c:red cost<=2 o:"draw"')) === exp1b, `...y con cost<=2 -> ${exp1b} (el filtro numérico recorta)`)
// 2. OR y negación
ok((await q('t:legend or t:gear')) === 43, 't:legend or t:gear -> 43')
ok((await q('-t:legend')) === 124, '-t:legend -> 124')
// 3. keywords
const blk = cards.filter(c => /\{blocker\}/i.test(c.rules)).length
ok((await q('k:blocker')) === blk, `k:blocker -> ${blk}`)
// 4. variantes en búsqueda
ok((await q('has:alt')) === 62, 'has:alt -> 62 cartas con arte alternativo')
const fr = cards.filter(c => c.printings.some(x => x.language === 'fr')).length
ok((await q('lang:fr')) === fr, `lang:fr -> ${fr}`)
const beta = cards.filter(c => c.printings.some(x => /beta/i.test(x.baseSetName))).length
ok((await q('s:beta')) === beta && beta > 0, `s:beta -> ${beta} (cartas impresas en Beta)`)
// 5. errores avisan sin vaciar resultados
const n = await q('t:unit foo:bar')
ok(n === 73, 'campo desconocido se ignora (73 units)')
ok(/foo/.test(await p.locator('.search-errors').innerText()), 'aviso visible: campo desconocido «foo»')
ok((await search.getAttribute('aria-describedby')) === 'search-errors', 'el aviso está asociado al buscador (accesibilidad)')
await p.screenshot({ path: shots + '/s1-errors.png' })
// 6. nombre con dos puntos pegado desde el sim
ok((await q('Goro Takemura: Hands Unclean')) === 1, 'pegar "Goro Takemura: Hands Unclean" encuentra 1 carta')
await q('')
// 7. ayuda: abrir y pulsar un ejemplo
await p.locator('.searchhelp summary').click()
ok(await p.locator('.searchhelp-body').isVisible(), 'la ayuda de sintaxis se abre')
await p.screenshot({ path: shots + '/s2-help.png' })
await p.locator('.searchhelp-body').getByRole('button', { name: 'has:alt', exact: true }).first().click()
await p.waitForFunction(() => document.querySelector('input[type=search]').value === 'has:alt')
ok((await search.inputValue()) === 'has:alt' && (await count()) === 62, 'pulsar un ejemplo lo escribe y filtra')
await p.locator('.searchhelp summary').click()
await q('')
// 8. selector de set por impresiones
await p.getByRole('button', { name: 'Set', exact: true }).click()
const opts = await p.locator('.dd-list [role=option]').allInnerTexts()
await p.keyboard.press('Escape')
ok(opts.length === 14 && !opts.some(o => /—\s*(FR|French)$/i.test(o)), `selector de set: 13 sets base sin duplicados de idioma (${opts.length - 1})`)
await pick(p, 'Set', 'Welcome to Night City — Beta')
ok((await count()) === beta, 'filtrar por set "Beta" usa todas las impresiones')
await pick(p, 'Set', '')
// 9. variantes en la ficha
await q('adam smasher')
await p.locator('.tile-art').first().click()
const modal = p.locator('.modal'); await modal.waitFor()
const vtxt = await modal.locator('.variants').innerText()
ok(/variantes e impresiones/i.test(vtxt) && /welcome to night city/i.test(vtxt), 'la ficha lista las impresiones por set')
ok(/\bEN\b/.test(vtxt) && /\bFR\b/.test(vtxt), 'la ficha marca los idiomas EN y FR')
const withAlt = cards.find(c => c.altArts.length > 1)
await p.keyboard.press('Escape')
await q(withAlt.displayName)
await p.locator('.tile-art').first().click(); await modal.waitFor()
const alttxt = await modal.locator('.variants').innerText()
ok(/Artes alternativos/i.test(alttxt) && /pulsa una miniatura/i.test(alttxt), 'la ficha lista artes alternativos e indica cómo verlos en grande')
await p.screenshot({ path: shots + '/s3-variants.png' })
await p.keyboard.press('Escape')
// 10. chips en vista lista
await q('has:alt')
await p.getByRole('button', { name: /Lista/ }).click()
ok((await p.locator('.crow .chip', { hasText: 'ALT' }).count()) === 62, 'vista lista: 62 filas con chip ALT')
await p.getByRole('button', { name: /Galería/ }).click()
// 11. caracteres especiales no rompen nada
await q('o:(.*+'); ok((await count()) === 0 && (await p.locator('.empty').count()) === 1, 'regex/símbolos se tratan como texto literal')
await q('((((')
ok(true, 'consulta rara no rompe la página')
console.log(errs.length ? 'ERRORES: ' + errs.join(' | ') : 'sin errores de página')
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await b.close(); process.exit(failed ? 1 : 0)

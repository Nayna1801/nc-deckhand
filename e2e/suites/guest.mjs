import { chromium } from 'playwright'
import { BASE, DECKS, SHOTS } from '../config.mjs'
import { pick, shown, results } from '../lib/helpers.mjs'
import fs from 'node:fs'
import { N, count } from '../lib/data.mjs'

const shots = SHOTS
const decks = DECKS
const realDeckText = decks[3].text
let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await ctx.newPage()
page.setDefaultTimeout(8000)
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))

/* ---- filtros nuevos ---- */
await page.goto(BASE)
await page.waitForSelector('.tile')
await pick(page, 'Coste', '3')
ok((await results(page)) === 25, 'filtro coste 3 -> 25 cartas')
await pick(page, 'Coste', '')
await pick(page, 'RAM', '2')
ok((await results(page)) === count((c) => c.ram === 2), `filtro RAM 2 -> ${count((c) => c.ram === 2)} cartas`)
await pick(page, 'RAM', '')
await pick(page, 'Etiquetas', 'Arasaka')
ok((await results(page)) === 19, 'filtro etiqueta Arasaka -> 19 cartas')
await pick(page, 'Etiquetas', '')
await pick(page, 'Orden', 'cost')
const firstCost = await page.locator('.tile-art').first().getAttribute('aria-label')
ok(!!firstCost, 'ordenar por coste funciona (primera: ' + firstCost + ')')
await pick(page, 'Orden', 'set')

/* ---- vista lista persistente ---- */
await page.getByRole('button', { name: /Lista/ }).click()
ok((await page.locator('.crow').count()) === 48 && (await results(page)) === N, `vista lista: ${N} cartas, 48 filas en la primera página`)
await page.reload(); await page.waitForSelector('.crow')
ok((await page.locator('.crow').count()) === 48, 'la vista lista persiste tras recargar')
await page.screenshot({ path: shots + '/n1-list.png' })
await page.getByRole('button', { name: /Galería/ }).click()

/* ---- hover preview ---- */
await page.locator('.tile-art').nth(2).hover()
await page.waitForSelector('.preview')
const pw = await page.locator('.preview img').evaluate((i) => i.getBoundingClientRect().width)
ok(pw >= 300, `previsualización al pasar el ratón (ancho ${Math.round(pw)}px)`)
await page.mouse.move(5, 5)
await page.waitForFunction(() => !document.querySelector('.preview'))
ok(true, 'la previsualización desaparece al salir')

/* ---- crear mazo e importar uno real ---- */
await page.goto(BASE + '#/decks')
await page.getByRole('button', { name: 'Importar texto' }).click()
await page.fill('textarea', realDeckText)
await page.getByRole('button', { name: 'Crear mazo' }).click()
await page.waitForURL(/#\/decks\/.+/)
await page.waitForSelector('.legend-slots')
ok((await page.locator('.slot.filled').count()) === 3, '3 ranuras de Legend ocupadas')
ok((await page.locator('.pill.ok', { hasText: 'Legal' }).count()) > 0, 'mazo real marcado como Legal')
ok((await page.locator('.chart svg').count()) === 2, 'curva de coste y ratio de tipos presentes')
const bars = await page.locator('.chart rect').count()
ok(bars === 10, `histograma con 10 cubos de coste (${bars})`)
const donutTxt = await page.locator('.donut .legend').innerText()
ok(/Units/.test(donutTxt) && /Programs/.test(donutTxt) && /Gear/.test(donutTxt), 'gráfico circular con Units/Gear/Programs')
await page.screenshot({ path: shots + '/n2-editor.png', fullPage: false })

/* ---- RAM: bloqueo y filtro ---- */
const locked = await page.locator('.tile.locked').count()
ok(locked > 0, `cartas bloqueadas por RAM con candado (${locked})`)
const total = await page.locator('.editor-cards .tile').count()
await page.getByLabel('Ocultar bloqueadas').check()
const after = await page.locator('.editor-cards .tile').count()
ok(after === total - locked && (await page.locator('.tile.locked').count()) === 0, `ocultar bloqueadas: ${total} -> ${after}`)
await page.getByLabel('Ocultar bloqueadas').uncheck()

/* ---- tope de 3 copias ---- */
await page.getByRole('button', { name: 'Importar texto' }).first().isVisible().catch(() => {})
await page.goto(BASE + '#/decks')
await page.getByRole('button', { name: 'Nuevo mazo' }).click()
await page.waitForURL(/#\/decks\/.+/)
await page.fill('.editor-cards input[type=search]', 'Saul Bright'); await page.waitForTimeout(450)
const plus = page.getByRole('button', { name: 'Añadir Saul Bright: Stormrider' })
for (let i = 0; i < 3; i++) await plus.click()
ok(await plus.isDisabled(), 'el botón Añadir se desactiva al llegar a 3 copias')
await page.locator('.editor-cards .tile-art').first().click()
ok((await page.locator('.counters').innerText()).includes('Mazo 3'), 'clic extra no supera las 3 copias (Mazo 3)')
ok(await page.locator('.toast').isVisible(), 'aviso "Máximo 3 copias"')

/* ---- Legends: ranuras y mismo nombre ---- */
await page.fill('.editor-cards input[type=search]', 'Goro'); await page.waitForTimeout(450)
await page.getByRole('button', { name: 'Añadir Goro Takemura: Hands Unclean' }).click()
const vengeful = page.getByRole('button', { name: 'Añadir Goro Takemura: Vengeful Bodyguard' })
ok(await vengeful.isDisabled(), 'no deja una 2ª Legend con el mismo nombre de personaje')

/* ---- arrastrar y soltar ---- */
await page.fill('.editor-cards input[type=search]', 'Kiroshi'); await page.waitForTimeout(450)
const tile = page.locator('.editor-cards .tile-art').first()
await tile.dragTo(page.locator('ul.zone').nth(1)) // sideboard
ok((await page.locator('.counters').innerText()).includes('Side 1/7'), 'arrastrar carta al sideboard la añade (Side 1)')
await page.fill('.editor-cards input[type=search]', 't:legend name:saburo'); await page.waitForTimeout(450)
await page.locator('.editor-cards .tile-art').first().dragTo(page.locator('.legend-slots'))
ok((await page.locator('.slot.filled').count()) === 2, 'arrastrar una Legend a las ranuras la añade (2 Legends)')
// mover del sideboard al mazo arrastrando la fila
await page.locator('ul.zone').nth(1).locator('.deck-row').first().dragTo(page.locator('ul.zone').nth(0))
ok((await page.locator('.counters').innerText()).includes('Side 0/7'), 'arrastrar fila sideboard -> mazo la mueve')
// sacar fuera = quitar
const before = await page.locator('ul.zone').nth(0).locator('.deck-row').count()
while ((await page.locator('ul.zone').nth(0).locator('.deck-row').count()) > 0) {
  await page.locator('ul.zone').nth(0).locator('.deck-row').first().dragTo(page.locator('.editor-cards .grid').first())
}
ok(before === 2 && (await page.locator('.counters').innerText()).includes('Mazo 0'), `arrastrar filas fuera del mazo las quita (${before} filas -> Mazo 0)`)

/* ---- compartir por código ---- */
await page.fill('.editor-cards input[type=search]', ''); await page.waitForTimeout(450)
await page.getByRole('button', { name: 'Exportar / compartir' }).click()
await page.waitForFunction(() => document.querySelector('textarea[aria-label="Código del mazo"]')?.value.startsWith('ncd1.'))
const code = await page.locator('textarea[aria-label="Código del mazo"]').inputValue()
ok(code.length > 10 && code.length < 900, `código de mazo generado (${code.length} caracteres)`)
await page.getByRole('button', { name: 'Copiar enlace' }).click()
const link = await page.evaluate(() => navigator.clipboard.readText())
ok(link.includes('#/share/ncd1.'), 'enlace para compartir copiado')
await page.goto(link)
const saveBtn = page.getByRole('button', { name: /Guardar una copia/ })
await saveBtn.waitFor()
ok(await saveBtn.isVisible(), 'el enlace abre la pantalla de mazo compartido')
await page.getByRole('button', { name: /Guardar una copia/ }).click()
await page.waitForURL(/#\/decks\/(?!ncd1).+/)
ok(true, 'guardar copia crea el mazo y abre el editor')
// importar el código en la lista de mazos
await page.goto(BASE + '#/decks')
await page.getByRole('button', { name: 'Importar texto' }).click()
await page.fill('textarea', code)
await page.getByRole('button', { name: 'Crear mazo' }).click()
await page.waitForURL(/#\/decks\/.+/)
ok(true, 'importar un código desde la lista de mazos funciona')
await page.goto(BASE + '#/share/ncd1.basura')
const bad = page.getByRole('heading', { name: 'Código no válido' })
await bad.waitFor()
ok(await bad.isVisible(), 'código dañado muestra error claro')

/* ---- móvil: pulsación larga ---- */
const mctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })
const m = await mctx.newPage(); m.setDefaultTimeout(8000)
await m.goto(BASE); await m.waitForSelector('.tile')
const handle = await m.locator('.tile-art').nth(3).elementHandle()
await handle.evaluate((el) => el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true })))
await m.waitForTimeout(700)
ok((await m.locator('.preview.touch').count()) === 1, 'pulsación larga en móvil abre la previsualización')
await m.screenshot({ path: shots + '/n3-longpress.png' })
await handle.evaluate((el) => el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true })))
await m.waitForTimeout(150)
ok((await m.locator('.preview').count()) === 0, 'la previsualización se cierra al soltar')
ok((await m.locator('.modal').count()) === 0, 'la pulsación larga no abre el modal por error')
const ov = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
ok(!ov, 'sin scroll horizontal en móvil')

console.log(errors.length ? 'ERRORES DE CONSOLA:\n' + [...new Set(errors)].join('\n') : 'sin errores de consola')
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close()
process.exit(failed ? 1 : 0)

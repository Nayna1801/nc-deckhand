import { chromium } from 'playwright'
import { BASE } from '../config.mjs'
import { pick, pickMany, shown } from '../lib/helpers.mjs'

let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
page.setDefaultTimeout(8000)
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))

await page.goto(BASE); await page.waitForSelector('.tile')
const count = () => page.locator('.tile').count()

/* ---- colores: azul + verde a la vez ---- */
await pick(page, 'Color', 'Blue'); const blue = await count()
await pick(page, 'Color', ''); await pick(page, 'Color', 'Green'); const green = await count()
await pick(page, 'Color', '')
ok(blue > 0 && green > 0, `azul ${blue} y verde ${green} por separado`)
await pickMany(page, 'Color', ['Blue', 'Green'])
ok((await count()) === blue + green, `azul + verde juntos = ${blue + green} cartas`)
ok((await shown(page, 'Color')) === 'Blue + Green', `el botón resume la selección ("${await shown(page, 'Color')}")`)

/* ---- el desplegable no se cierra al elegir y se puede desmarcar ---- */
await page.getByRole('button', { name: 'Color', exact: true }).click()
await page.locator('.dd-list [role=option][data-value="Green"]').click()
ok(await page.locator('.dd-list').isVisible(), 'la lista sigue abierta tras marcar/desmarcar')
ok((await page.locator('.dd-list [role=option][aria-selected=true]').count()) === 1, 'solo queda marcada Blue')
ok((await count()) === blue, 'al desmarcar verde quedan solo las azules')
await page.locator('.dd-list [role=option][data-value=""]').click()
ok((await count()) === 150, '"Todos" vacía la selección')
await page.keyboard.press('Escape')
ok(!(await page.locator('.dd-list').count()), 'Escape cierra la lista')

/* ---- teclado: espacio marca, flechas mueven ---- */
await page.getByRole('button', { name: 'Tipo', exact: true }).focus()
await page.keyboard.press('ArrowDown')
await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space')
await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space')
const typeShown = await shown(page, 'Tipo')
ok(/\+/.test(typeShown), `con teclado se marcan dos tipos ("${typeShown}")`)
await page.keyboard.press('Escape')
await pick(page, 'Tipo', '')

/* ---- Etiquetas (antes Facción): Quickhack + Braindance ---- */
ok((await page.getByRole('button', { name: 'Facción', exact: true }).count()) === 0, 'ya no existe el filtro "Facción"')
await pick(page, 'Etiquetas', 'Quickhack'); const qh = await count()
await pick(page, 'Etiquetas', ''); await pick(page, 'Etiquetas', 'Braindance'); const bd = await count()
await pick(page, 'Etiquetas', '')
ok(qh > 0 && bd > 0, `Quickhack ${qh} y Braindance ${bd} por separado`)
await pickMany(page, 'Etiquetas', ['Quickhack', 'Braindance'])
const either = await count()
ok(either >= Math.max(qh, bd) && either <= qh + bd, `Quickhack o Braindance = ${either} cartas`)
const toggle = page.getByRole('button', { name: /Etiquetas: cualquiera/ })
ok(await toggle.isVisible(), 'con 2 etiquetas aparece el selector "cualquiera / todas"')
await toggle.click()
const both = await count()
ok(both <= Math.min(qh, bd) && both === qh + bd - either, `modo "todas a la vez": ${both} cartas con ambas (inclusión-exclusión)`)
await page.getByRole('button', { name: /Etiquetas: todas a la vez/ }).click()
ok((await count()) === either, 'volver a "cualquiera" recupera la unión')

/* ---- cruzar filtros distintos y limpiar ---- */
await pickMany(page, 'Color', ['Blue', 'Green'])
const crossed = await count()
ok(crossed <= either, `etiquetas y color se cruzan (${crossed} ≤ ${either})`)
await page.getByRole('button', { name: 'Limpiar' }).click()
ok((await count()) === 150, 'Limpiar quita todas las selecciones')

/* ---- móvil: la lista múltiple cabe y se puede usar ---- */
await page.setViewportSize({ width: 390, height: 800 })
await page.getByRole('button', { name: /^Filtros/ }).click()
await pickMany(page, 'Rareza', ['Rare', 'Epic'])
await pickMany(page, 'Color', ['Blue', 'Green'])
const fbtn = await page.getByRole('button', { name: /^Filtros/ }).innerText()
ok(/filtros \(2\)/i.test(fbtn), `móvil: el contador cuenta 2 filtros activos aunque tengan varias opciones ("${fbtn}")`)
await pick(page, 'Color', '')
const rareEpic = await count()
ok(rareEpic > 0 && rareEpic < 150, `móvil: Rare + Epic = ${rareEpic} cartas`)

/* ---- búsqueda por texto con tag: ---- */
await page.getByRole('button', { name: 'Limpiar' }).click()
await page.locator('input[type=search]').fill('tag:quickhack'); await page.waitForTimeout(450)
ok((await count()) === qh, `búsqueda tag:quickhack = ${qh}`)

console.log(errors.length ? 'ERRORES: ' + errors.join(' | ') : 'sin errores de página')
ok(errors.length === 0, 'sin errores de consola')
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close(); process.exit(failed ? 1 : 0)

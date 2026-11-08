import { chromium } from 'playwright'
import { BASE } from '../config.mjs'
import { newSession } from '../lib/mock.mjs'

let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const browser = await chromium.launch()
const { page, store, errors } = await newSession(browser, { legacy: false })
let answer = true
const dialogs = []
page.on('dialog', (d) => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss() })

await page.goto(BASE); await page.waitForSelector('.tile')

/* ---- preparar: Legend ×4 (bulk 3) y Saul Bright ×5 (bulk 2) ---- */
const firstTile = page.locator('.tile').first()
for (let i = 0; i < 4; i++) await firstTile.getByRole('button', { name: 'Añadir uno' }).click()
const firstId = [...store.collection.keys()][0]
await page.locator('input[type=search]').fill('name:"Saul Bright"'); await page.waitForTimeout(450)
for (let i = 0; i < 5; i++) await page.locator('.tile').first().getByRole('button', { name: 'Añadir uno' }).click()
await page.waitForTimeout(500)
ok(store.collection.get(firstId)?.quantity === 4 && store.collection.get('saul_bright_stormrider')?.quantity === 5, 'preparado: 4 copias de una Legend y 5 de otra carta')

await page.goto(BASE + '#/collection'); await page.waitForSelector('.stats-row')
await page.getByRole('tab', { name: /Bulk/ }).click()
const rows = page.locator('.panel .deck-row')
ok((await rows.count()) === 2, 'el bulk lista 2 cartas')
ok(/intercambio \(5\)/i.test(await page.getByRole('tab', { name: /Bulk/ }).innerText()), 'la pestaña indica 5 copias de bulk')

/* ---- retirar una sola con la cantidad elegida ---- */
const legendRow = rows.filter({ hasText: 'bulk ×3' })
await legendRow.getByRole('button', { name: 'Quitar uno' }).click()
ok((await legendRow.locator('.stepper-n').innerText()).trim() === '2', 'el contador de la fila baja de 3 a 2 copias a retirar')
answer = false
await legendRow.getByRole('button', { name: /^Retirar / }).click()
await page.waitForTimeout(300)
ok(dialogs.length === 1 && /2 copias/.test(dialogs[0]), `pide confirmación antes de retirar ("${dialogs[0]}")`)
ok(store.collection.get(firstId)?.quantity === 4, 'si cancelas no se descuenta nada')
answer = true
await legendRow.getByRole('button', { name: /^Retirar / }).click()
await page.waitForTimeout(500)
ok(store.collection.get(firstId)?.quantity === 2, 'retirar 2 de 4 deja 2 en la base de datos')
ok(/bulk ×1/i.test(await rows.filter({ hasText: /bulk ×1/i }).innerText()), 'la fila pasa a bulk ×1')

/* ---- retirar seleccionadas ---- */
const retirarSel = page.getByRole('button', { name: /^Retirar seleccionadas/ })
ok(await retirarSel.isDisabled(), 'sin selección el botón está desactivado')
await page.getByRole('button', { name: 'Seleccionar todo' }).click()
ok(/\(3\)/.test(await retirarSel.innerText()), `con todo marcado ofrece retirar 3 copias ("${await retirarSel.innerText()}")`)
await retirarSel.click()
await page.waitForTimeout(600)
ok(store.collection.get(firstId)?.quantity === 1, 'la Legend queda en su playset (1)')
ok(store.collection.get('saul_bright_stormrider')?.quantity === 3, 'la otra carta queda en su playset (3)')
ok((await rows.count()) === 0 && /todavía no tienes copias sobrantes/i.test(await page.locator('.panel', { hasText: 'Un playset son 3 copias' }).innerText()), 'el bulk queda vacío')
ok(/intercambio \(0\)/i.test(await page.getByRole('tab', { name: /Bulk/ }).innerText()), 'la pestaña indica 0 copias de bulk')

/* ---- las copias retiradas ya no cuentan en la colección ---- */
await page.reload(); await page.waitForSelector('.stats-row')
ok(/4\s*copias en total/i.test((await page.locator('.stats-row').innerText()).replace(/\n/g, ' ')), 'tras recargar la colección suma 4 copias (1 + 3)')

ok(errors.length === 0, 'sin errores de página' + (errors.length ? ': ' + errors.join(' | ') : ''))
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close(); process.exit(failed ? 1 : 0)

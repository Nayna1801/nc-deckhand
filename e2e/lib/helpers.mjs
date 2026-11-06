/** Elige una opción de un desplegable propio (Dropdown): botón con aria-label=etiqueta + opción con data-value. */
export async function pick(page, label, value) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.locator(`.dd-list [role=option][data-value="${value}"]`).click()
  await closeMulti(page)
}

/** Marca varias opciones de un desplegable múltiple sin cerrarlo entre una y otra, y lo cierra al final. */
export async function pickMany(page, label, values) {
  await page.getByRole('button', { name: label, exact: true }).click()
  for (const v of values) await page.locator(`.dd-list [role=option][data-value="${v}"]`).click()
  await closeMulti(page)
}

/** Los desplegables múltiples se quedan abiertos al elegir: Escape los cierra (los simples ya se cerraron solos). */
async function closeMulti(page) {
  if (await page.locator('.dd-list[aria-multiselectable=true]').count()) await page.keyboard.press('Escape')
}

/** Valor mostrado actualmente en un desplegable. */
export async function shown(page, label) {
  return (await page.getByRole('button', { name: label, exact: true }).locator('.dd-val').innerText()).trim()
}

/** Espera (con reintentos) a que `read()` devuelva el valor esperado; devuelve el último valor leído. */
export async function until(read, expected, timeout = 3000) {
  const t0 = Date.now()
  let v = await read()
  while (v !== expected && Date.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 50))
    v = await read()
  }
  return v
}

/** Total de resultados de la lista de Cartas (todas las páginas): la pantalla solo pinta la página actual. */
export async function results(page) {
  const n = await page.locator('[data-results]').first().getAttribute('data-results')
  return Number(n)
}

/** Fichas pintadas ahora mismo (la página actual). */
export const painted = (page) => page.locator('.tile').count()

const pagerBtn = (page, name) => page.getByRole('button', { name, exact: true }).first()

/** Va a la página n de la lista de Cartas (si hay paginación). */
export async function goPage(page, n) {
  const b = pagerBtn(page, `Página ${n}`)
  if (await b.count()) await b.click()
  await page.waitForTimeout(80)
}

/** Lee `read(page)` en cada página de la lista y junta los resultados; deja la lista en la página 1. */
export async function collect(page, read) {
  await goPage(page, 1)
  const out = []
  for (let guard = 0; guard < 50; guard++) {
    out.push(...(await read(page)))
    const next = pagerBtn(page, 'Página siguiente')
    if (!(await next.count()) || (await next.isDisabled())) break
    await next.click()
    await page.waitForTimeout(80)
  }
  await goPage(page, 1)
  return out
}

/** Recorre las páginas hasta que `selector` aparece; devuelve true si lo encontró (y se queda en esa página). */
export async function findOnPages(page, selector) {
  await goPage(page, 1)
  for (let guard = 0; guard < 50; guard++) {
    if (await page.locator(selector).count()) return true
    const next = pagerBtn(page, 'Página siguiente')
    if (!(await next.count()) || (await next.isDisabled())) return false
    await next.click()
    await page.waitForTimeout(80)
  }
  return false
}

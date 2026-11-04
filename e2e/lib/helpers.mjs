/** Elige una opción de un desplegable propio (Dropdown): botón con aria-label=etiqueta + opción con data-value. */
export async function pick(page, label, value) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.locator(`.dd-list [role=option][data-value="${value}"]`).click()
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

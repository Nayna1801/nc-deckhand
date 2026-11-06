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

/**
 * La web ya no usa window.confirm: pregunta con un cuadro propio (role="alertdialog").
 * Este ayudante hace lo que antes hacía `page.on('dialog', …)`: responde solo y guarda lo que se preguntó.
 * Debe llamarse ANTES de `page.goto`:
 *   const c = await autoConfirm(page)      // acepta todo
 *   c.answer = false                       // a partir de ahora cancela
 *   c.asked                                // textos de los cuadros que han salido (título / mensaje)
 */
export async function autoConfirm(page, { answer = true } = {}) {
  const state = { answer, asked: [] }
  await page.exposeFunction('__ncConfirmAsked', (text) => {
    state.asked.push(String(text).replace(/\s*\n\s*/g, ' / ').trim())
    return state.answer
  })
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const dlg = document.querySelector('.confirm')
      if (!dlg || dlg.dataset.answered) return
      dlg.dataset.answered = '1'
      window.__ncConfirmAsked(dlg.innerText).then((ok) => {
        const buttons = dlg.querySelectorAll('.confirm-actions .btn')
        ;(ok ? buttons[buttons.length - 1] : buttons[0]).click()
      })
    }).observe(document, { childList: true, subtree: true })
  })
  return state
}

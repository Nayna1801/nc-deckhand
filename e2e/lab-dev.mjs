// Prueba de navegador detallada de la mesa del modo «Jugar contra el piloto» del Laboratorio, contra el servidor de desarrollo (motor en el
// Python del equipo). No forma parte de `npm run e2e` (ahí está la suite `lab`, con el motor del navegador): arranca `npm run dev` y lanza esto en otra terminal.
//
//   npm run dev                                  (en una terminal)
//   node e2e/lab-dev.mjs                         (en otra; 1920x1080 por defecto)
//   node e2e/lab-dev.mjs --size 1366x768 --url http://localhost:5173
//
// Comprueba: la distribución de la mesa, zoom al pasar el ratón, acciones de la carta tocada, arrastrar para vender / jugar / atacar,
// pagar tocando Eddies y Legends, el mazo y la basura, equipar Gear arrastrándolo a una Unidad o a una Legend boca arriba,
// que la mesa cabe sin desplazarse, que no hay desbordes ni errores de consola y que una partida entera se puede jugar con clics.
// Termina con código distinto de 0 si algo falla.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const URL = arg('url', 'http://localhost:5173')
const [W, H] = arg('size', '1920x1080').split('x').map(Number)
const MINE = '.pt-side.mine'
const RIVAL = '.pt-side.rival'
const catalog = JSON.parse(readFileSync(new globalThis.URL('../src/data/cards.json', import.meta.url), 'utf8'))
const TYPE = new Map((Array.isArray(catalog) ? catalog : catalog.cards).map((c) => [c.displayName, c.type]))
const failures = []

const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${name}${extra ? ' · ' + extra : ''}`)
  if (!cond) failures.push(name)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(`pageerror: ${e}`))

const settle = async () => {
  await page.waitForTimeout(120)
  await page.waitForFunction(() => !document.querySelector('.pt-busy'), null, { timeout: 120_000 })
  await page.waitForTimeout(80)
}
const title = () => page.locator('.pt-ap-title').innerText() // el estilo lo pone en mayúsculas: se compara sin distinguirlas
const options = () => page.locator('.pt-actions .pt-opt').allInnerTexts()
const log = () => page.locator('.pt-log').innerText()
let payChecked = false
/** Paga tocando en la mesa los Eddies y las Legends que se gastan; la primera vez que hay que pagar más de 1 €, lo comprueba todo. */
const payByTouch = async () => {
  const need = Number((await title()).match(/Pagas (\d+)/i)[1])
  const legs = page.locator(`${MINE} .pt-zone[aria-label="Zona de Legends"] .pt-card.cand`)
  const eddies = page.locator(`${MINE} .pt-eddy.cand`)
  const unmarked = page.locator(`${MINE} .pt-eddy.cand:not(.paid), ${MINE} .pt-zone[aria-label="Zona de Legends"] .pt-card.cand:not(.paid)`)
  const full = !payChecked && need > 1 && (await legs.count()) > 0 && (await eddies.count()) > 0
  if (full) {
    payChecked = true
    ok('al pagar se pueden tocar las Legends y los Eddies sueltos que se gastan', true, `${await legs.count()} Legends y ${await eddies.count()} Eddies, hay que pagar ${need}`)
    ok('no hay una lista de combinaciones: solo la mesa y «que se pague solo»', (await page.locator('.pt-actions .pt-opt').count()) === 1)
    await eddies.first().click()
    ok('el Eddie tocado se ilumina y el panel lleva la cuenta', (await page.locator(`${MINE} .pt-eddy.paid`).count()) === 1 && new RegExp(`1 de ${need} €`).test(await page.locator('.pt-pay-hint').innerText()))
    await eddies.first().click()
    ok('un segundo toque lo desmarca', (await page.locator(`${MINE} .pt-eddy.paid`).count()) === 0 && /Pagas/i.test(await title()))
    await legs.first().click()
    ok('la Legend marcada se ilumina', (await page.locator(`${MINE} .pt-card.paid`).count()) === 1)
    for (let i = 1; i < need; i++) {
      ok(`con ${i} de ${need} marcados todavía no se paga`, /Pagas/i.test(await title()))
      await unmarked.first().click()
    }
  } else {
    for (let i = 0; i < need && /Pagas/i.test(await title()); i++) await unmarked.first().click()
  }
  await settle()
  if (full) ok('al marcar el último se paga solo, sin más botones', !/Pagas/i.test(await title()))
}

/** Contesta preguntas intermedias (dados, objetivos...) con la primera opción hasta volver al turno. */
const backToTurn = async () => {
  for (let i = 0; i < 6 && !/Tu turno/i.test(await title()); i++) {
    await page.locator('.pt-actions .pt-opt:not([disabled])').first().click()
    await settle()
  }
}

try {
  await page.goto(`${URL}/#/lab`)
  await page.getByRole('tab', { name: 'Jugar contra el piloto' }).click()
  await page.getByLabel('Tu mazo').selectOption('meta/rivers_closet') // lleva mucho Gear: da ocasión de equiparlo
  await page.getByLabel('Mazo del piloto').selectOption('meta/red_aggro')
  await page.getByRole('button', { name: 'Empezar partida' }).click()
  await page.waitForSelector('.pt-actions', { timeout: 60_000 })
  await page.locator('.pt-opt', { hasText: /Quedarme/i }).click()
  await settle()
  await backToTurn()
  ok('empieza nuestro turno', /Tu turno/i.test(await title()), (await title()).slice(0, 40))

  // distribución: fixer | campo | Gigs sobre mazo y basura; debajo mano | Legends | Eddies; el rival, invertido
  const boxes = await page.evaluate(() => {
    const b = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom } }
    const side = (s) => ({ fixer: b(`${s} .pt-fixer`), field: b(`${s} .pt-field`), gigs: b(`${s} .pt-gigs`), piles: b(`${s} .pt-piles`), hand: b(`${s} .pt-hand`), legs: b(`${s} .pt-legs`), eddies: b(`${s} .pt-eddyzone`) })
    return { me: side('.pt-side.mine'), op: side('.pt-side.rival') }
  })
  const { me: m, op: r } = boxes
  ok('tu lado: fixer a la izquierda del campo, y a su derecha los Gigs sobre el mazo y la basura', m.fixer.r <= m.field.l + 1 && m.field.r <= m.gigs.l + 1 && m.gigs.b <= m.piles.t + 1 && Math.abs(m.gigs.l - m.piles.l) < 2)
  ok('debajo, en una fila: mano, Legends y Eddies', m.hand.t >= m.field.b - 1 && m.hand.r <= m.legs.l + 1 && m.legs.r <= m.eddies.l + 1)
  ok('el lado del piloto es el mismo invertido (su mano arriba, sus Gigs junto al centro)', r.hand.b <= r.field.t + 1 && r.piles.b <= r.gigs.t + 1 && r.field.b <= m.field.t && r.fixer.r <= r.field.l + 1)
  const deck = await page.locator(`${MINE} .pt-deckcard .pt-count`).first().innerText()
  ok('el mazo es un dorso con las cartas que quedan', /^\d+$/.test(deck) && Number(deck) > 20 && (await page.locator(`${RIVAL} .pt-deckcard .pt-count`).count()) >= 1, `${deck} cartas`)

  // la mesa cabe en la pantalla y las cartas no son diminutas
  const fit = await page.evaluate(() => {
    const t = document.querySelector('.pt-table')
    return { falta: t.scrollHeight - t.clientHeight, pagina: document.documentElement.scrollHeight - window.innerHeight, ancho: document.documentElement.scrollWidth - window.innerWidth }
  })
  ok('la mesa cabe sin desplazarse', fit.falta <= 1 && fit.pagina <= 1, `faltan ${fit.falta}px en la mesa, ${fit.pagina}px en la página`)
  ok('sin desbordamiento horizontal', fit.ancho <= 0, `${fit.ancho}px`)
  const box = await page.locator(`${MINE} .pt-hand .pt-card`).first().boundingBox()
  ok('las cartas de la mano tienen un tamaño usable', box.width >= Math.min(52, (H - 379) / 7 - 2), `${Math.round(box.width)}×${Math.round(box.height)} px`)

  // zoom al pasar el ratón
  await page.locator(`${MINE} .pt-hand .pt-card`).first().hover()
  await page.waitForSelector('.pt-zoom', { timeout: 3000 }).catch(() => {})
  const zoom = page.locator('.pt-zoom')
  ok('al pasar el ratón sale el zoom', (await zoom.count()) === 1)
  if (await zoom.count()) {
    const z = await zoom.boundingBox()
    ok('el zoom es grande y cabe en la pantalla', z.width >= 300 && z.x >= 0 && z.x + z.width <= W && z.y >= 0 && z.y + z.height <= H)
  }
  await page.mouse.move(5, 5)
  await page.waitForTimeout(200)
  ok('el zoom desaparece al salir', (await page.locator('.pt-zoom').count()) === 0)

  // tocar una carta enseña solo sus acciones
  const can = page.locator(`${MINE} .pt-hand .pt-card.can`)
  ok('se resaltan las cartas con acciones', (await can.count()) > 0, `${await can.count()} cartas`)
  await can.first().click()
  const own = await options()
  ok('al tocar una carta salen solo sus acciones', (await page.locator(`${MINE} .pt-card.sel`).count()) === 1 && own.length < 6, own.map((t) => t.replace(/\n/g, ' ').slice(0, 30)).join(' | '))

  // arrastrar a Eddies = vender (una carta que solo se pueda vender)
  let sold = false
  for (let k = 0; k < (await can.count()) && !sold; k++) {
    await can.nth(k).click()
    if ((await page.locator(`${MINE} .pt-card.sel`).count()) === 0) await can.nth(k).click() // ya estaba seleccionada: tocarla otra vez la quita
    const t = (await options()).join(' ')
    if (/Vender/i.test(t) && !/Jugar/i.test(t)) {
      await can.nth(k).dragTo(page.locator(`${MINE} .pt-zone[aria-label="Zona de Eddies"]`))
      await settle()
      sold = /vende/.test(await log())
    }
  }
  ok('arrastrar una carta a los Eddies la vende', sold)

  // arrastrar a la mesa = jugar; con Eddies sueltos y Legends listas pregunta con qué se paga
  let played = false
  for (let k = 0; k < (await can.count()) && !played; k++) {
    await can.nth(k).click()
    if (!/Jugar/i.test((await options()).join(' '))) continue
    await can.nth(k).dragTo(page.locator(`${MINE} .pt-field`))
    await settle()
    if (/Pagas/i.test(await title())) await payByTouch()
    played = /juega/.test(await log())
  }
  let dragPlayed = played
  if (played) ok('arrastrar una carta a la mesa la juega', true)
  await backToTurn()
  await page.locator('.pt-ap-end .pt-opt', { hasText: /Terminar/i }).click()
  await settle()

  // partida entera con clics (y un ataque arrastrando a los Gigs rival si se presenta)
  let attackDrag = false
  let trashSeen = false
  let gearUnit = false
  let gearLegend = false
  let riverDone = false
  let subAttack = false
  let subClick = false
  let callReact = false
  /** Arrastra un Gear de la mano a `target` y comprueba que queda debajo de esa carta y se ve en grande al pasar el ratón. */
  const equip = async (card, target, label) => {
    const host = target.locator('xpath=..')
    const before = await host.locator('.pt-gearcard').count()
    const name = await card.getAttribute('aria-label')
    await card.dragTo(target)
    await settle()
    for (let i = 0; i < 4 && /Pagas/i.test(await title()); i++) await payByTouch()
    const after = await host.locator('.pt-gearcard').count()
    ok(`arrastrar un Gear sobre ${label} lo equipa a esa carta, sin preguntar a cuál`, after === before + 1 && !/se equipa/i.test(await title()), `${name}: ${before} → ${after}`)
    if (after > before) {
      const box = await host.locator('.pt-gearcard').last().boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height - 3)
      await page.waitForSelector('.pt-zoom', { timeout: 3000 }).catch(() => {})
      ok(`el Gear queda debajo de ${label} y se ve en grande al pasar el ratón`, (await page.locator('.pt-zoom').count()) === 1 && (await page.locator('.pt-zoom-text b').innerText()) === name)
      await page.mouse.move(5, 5)
      await page.waitForTimeout(200)
    }
    return after > before
  }
  for (let step = 0; step < 400; step++) {
    if (await page.getByText('Repaso de la partida').count()) break
    const t = await title().catch(() => '')
    if (/Tu turno/i.test(t)) {
      const mine = page.locator(`${MINE} .pt-card.can`)
      let did = false
      const pile = page.locator(`${MINE} .pt-piles .pt-card[role=button]`)
      if (!trashSeen && (await pile.count())) {
        trashSeen = true
        const n = Number(await pile.locator('.pt-count').innerText())
        const topName = (await pile.getAttribute('aria-label')).match(/Arriba, (.*)\. Toca/)?.[1]
        await pile.click()
        await page.waitForSelector('.pt-trash')
        const listed = await page.locator('.pt-trash-cards .pt-card').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
        ok('la basura enseña la última carta que cayó y, al tocarla, la lista de todas', listed.length === n && n > 0 && listed[0] === topName, `${n} cartas, arriba ${topName}`)
        await page.keyboard.press('Escape')
        ok('la lista de la basura se cierra con Esc', (await page.locator('.pt-trash').count()) === 0)
      }
      // girar Legends (Call) hasta que salga River Ward: para equipar Gear a una Legend y para probar su habilidad
      const callBtn = page.locator(`${MINE} .pt-call:not([disabled])`)
      const riverUp = page.locator(`${MINE} .pt-legs .pt-card[aria-label^="River Ward"]`)
      if (!riverDone && !(await riverUp.count()) && (await callBtn.count())) {
        await callBtn.first().click()
        await settle()
        continue
      }
      // River Ward: tocarla no gasta nada; se activa con su botón y después se arrastra el Gear a la Unidad o Legend que se quiera
      const river = page.locator(`${MINE} .pt-legs .pt-card.can[aria-label^="River Ward"]`)
      if (!riverDone && (await river.count())) {
        await river.click()
        const opts = page.locator('.pt-actions .pt-ap-block .pt-opt')
        const texts = await opts.allInnerTexts()
        const idx = texts.findIndex((x) => /River Ward: gastarla/i.test(x))
        if (idx < 0) await river.click()
        else {
          riverDone = true
          ok('tocar a River Ward no gasta nada: enseña una sola acción para activarla', texts.filter((x) => /River Ward/i.test(x)).length === 1 && /Tu turno/i.test(await title()) && !(await river.evaluate((e) => e.classList.contains('spent'))))
          await opts.nth(idx).click()
          await settle()
          ok('al activarla pide el Gear y deja no usarla', /River Ward: elige/i.test(await title()) && /No usar/i.test(await page.locator('.pt-ap-end .pt-opt').innerText()))
          const host = page.locator(`${MINE} .pt-legs .pt-unit`).filter({ has: page.locator('.pt-card[aria-label^="River Ward"]') })
          const before = await host.locator('.pt-gearcard').count()
          const unitGear = await page.locator(`${MINE} .pt-field .pt-gearcard`).count()
          const gear = page.locator(`${MINE} .pt-hand .pt-card.can`).first()
          const name = await gear.getAttribute('aria-label')
          await gear.dragTo(host.locator(':scope > .pt-card'))
          await settle()
          const after = await host.locator('.pt-gearcard').count()
          ok('arrastrar el Gear sobre River Ward lo equipa a ella, no a una Unidad, y sin más preguntas', after === before + 1 && (await page.locator(`${MINE} .pt-field .pt-gearcard`).count()) === unitGear && /Tu turno/i.test(await title()), `${name}: ${before} → ${after}`)
          ok('River Ward queda gastada y el Gear ha salido gratis', await host.locator(':scope > .pt-card').evaluate((e) => e.classList.contains('spent')) && /juega .*\(gratis\)/.test(await log()))
          continue
        }
      }
      // jugar una carta (que no sea Gear) arrastrándola a la mesa
      const playable = page.locator(`${MINE} .pt-hand .pt-card.can`)
      for (let k = 0; k < (await playable.count()) && !dragPlayed; k++) {
        const card = playable.nth(k)
        if (TYPE.get(await card.getAttribute('aria-label')) === 'Gear') continue
        await card.click()
        const texts = await page.locator('.pt-actions .pt-ap-block .pt-opt').allInnerTexts()
        if ((await page.locator(`${MINE} .pt-card.sel`).count()) === 0 || !texts.some((x) => /Jugar/i.test(x))) continue
        const before = (await log()).length
        await card.dragTo(page.locator(`${MINE} .pt-field`))
        await settle()
        for (let i = 0; i < 4 && /Pagas/i.test(await title()); i++) await payByTouch()
        dragPlayed = /juega/.test((await log()).slice(before))
        ok('arrastrar una carta a la mesa la juega', dragPlayed)
        did = true
      }
      if (did) continue
      // equipar un Gear arrastrándolo a una Unidad y a una Legend boca arriba
      const handCards = page.locator(`${MINE} .pt-hand .pt-card.can`)
      for (let k = 0; k < (await handCards.count()) && !did; k++) {
        const card = handCards.nth(k)
        if (TYPE.get(await card.getAttribute('aria-label')) !== 'Gear') continue
        await card.click()
        if (!(await page.locator('.pt-actions .pt-ap-block .pt-opt').allInnerTexts()).some((x) => /^\d?\s*Jugar/i.test(x.replace(/\n/g, ' ')))) { await card.click(); continue }
        const legend = page.locator(`${MINE} .pt-legs .pt-unit > .pt-card:not(.back)`)
        const unit = page.locator(`${MINE} .pt-field .pt-unit > .pt-card`)
        if (!gearLegend && (await legend.count())) { gearLegend = await equip(card, legend.first(), 'una Legend boca arriba'); did = true }
        else if (!gearUnit && (await unit.count())) { gearUnit = await equip(card, unit.first(), 'una Unidad'); did = true }
        else await card.click()
      }
      if (did) continue
      const units = page.locator(`${MINE} .pt-field .pt-card.can`)
      // acciones y subacciones: «Atacar a una Unidad…» no enseña la lista de Unidades hasta que se abre (aquí solo se mira: no ataca)
      for (let k = 0; k < (await units.count()) && !subAttack; k++) {
        await units.nth(k).click()
        if ((await page.locator(`${MINE} .pt-card.sel`).count()) === 0) await units.nth(k).click()
        const toggle = page.locator('.pt-sub-toggle', { hasText: /Atacar a una Unidad/ })
        if (await toggle.count()) {
          subAttack = true
          const rivals = page.locator(`${RIVAL} .pt-field .pt-card.cand`)
          ok('al tocar una Unidad sale «Atacar a una Unidad…», no la lista de Unidades rivales', !(await options()).some((x) => /rival, poder/i.test(x)) && (await rivals.count()) === 0)
          await toggle.click()
          const n = await page.locator('.pt-sub-list .pt-opt').count()
          ok('al abrirla sale la lista y esas Unidades rivales se resaltan en la mesa', n > 0 && (await rivals.count()) === n && (await page.locator('.pt-sub-list .pt-opt').allInnerTexts()).every((x) => /rival, poder/i.test(x)), `${n} Unidades`)
          await toggle.click()
          ok('al cerrarla se recoge la lista y nada se ha atacado', (await page.locator('.pt-sub-list').count()) === 0 && (await rivals.count()) === 0 && /Tu turno/i.test(await title()))
        }
        await units.nth(k).click() // se deja sin seleccionar para las comprobaciones siguientes
      }
      // y con la lista abierta, tocar la Unidad rival en la mesa la ataca (cuando ya se ha probado el arrastre a los Gigs)
      for (let k = 0; k < (await units.count()) && subAttack && attackDrag && !subClick && !did; k++) {
        await units.nth(k).click()
        if ((await page.locator(`${MINE} .pt-card.sel`).count()) === 0) await units.nth(k).click()
        const toggle = page.locator('.pt-sub-toggle', { hasText: /Atacar a una Unidad/ })
        if (!(await toggle.count())) {
          await units.nth(k).click()
          continue
        }
        subClick = true
        await toggle.click()
        const before = (await log()).length
        await page.locator(`${RIVAL} .pt-field .pt-card.cand`).first().click()
        await settle()
        ok('con la lista abierta, tocar la Unidad rival en la mesa la ataca', /ataca con/.test((await log()).slice(before)))
        did = true
      }
      if (did) continue
      if (!attackDrag && (await units.count())) {
        await units.first().click()
        if ((await page.locator('.pt-actions .pt-ap-block .pt-opt').allInnerTexts()).some((x) => /Atacar.*Gigs/i.test(x))) {
          attackDrag = true
          const before = (await log()).length
          await units.first().dragTo(page.locator('.pt-side.rival .pt-zone[aria-label="Zona de Gigs"]'))
          await settle()
          ok('arrastrar una Unidad a los Gigs rivales ataca', /ataca con/.test((await log()).slice(before)))
          did = true
        } else await units.first().click() // se deja sin seleccionar
      }
      if (did) continue
      for (let k = 0; k < (await mine.count()) && !did; k++) {
        await mine.nth(k).click()
        const o = page.locator('.pt-actions .pt-ap-block .pt-opt')
        const pick = (await o.allInnerTexts()).findIndex((x) => /Jugar|Vender|Atacar|Go Solo/i.test(x))
        if (pick >= 0) {
          await o.nth(pick).click()
          did = true
        }
      }
      if (!did) await page.locator('.pt-ap-end .pt-opt').click()
    } else if (/Pagas/i.test(t)) {
      if (payChecked) await page.locator('.pt-actions .pt-ap-block .pt-opt').first().click() // «que se pague solo»
      else await payByTouch()
    } else {
      // al ser atacado se puede hacer Call (1 €), una vez por turno del rival
      const react = page.locator('.pt-actions .pt-opt', { hasText: /Call \(1 €\)/ })
      if (!callReact && /ataca con/i.test(t) && (await react.count())) {
        callReact = true
        const up = () => page.locator(`${MINE} .pt-legs .pt-card:not(.back)`).count()
        const before = await up()
        const lines = (await log()).length
        await react.first().click()
        await settle()
        ok('al ser atacado se puede hacer Call (1 €) y gira una Legend', (await up()) === before + 1 && /Call/.test((await log()).slice(lines)))
        if (/ataca con/i.test(await title())) ok('y en ese ataque ya no se ofrece otro Call', (await react.count()) === 0)
        continue
      }
      await page.locator('.pt-actions .pt-opt:not([disabled])').first().click()
    }
    await settle()
  }
  await page.waitForSelector('text=Repaso de la partida', { timeout: 60_000 })
  ok('se puede jugar una partida entera con clics y arrastres', true, await page.locator('.pb-result h3').innerText())
  ok('en la partida se ha visto la basura', trashSeen)
  if (!attackDrag) console.log('AVISO en esta partida no se presentó la ocasión de atacar los Gigs arrastrando')
  if (!subAttack) console.log('AVISO en esta partida no se presentó la ocasión de ver «Atacar a una Unidad…»')
  if (!subClick) console.log('AVISO en esta partida no hubo una segunda ocasión para atacar a una Unidad rival tocándola en la mesa')
  if (!callReact) console.log('AVISO en esta partida no se presentó la ocasión de hacer Call al ser atacado')
  if (!riverDone) console.log('AVISO en esta partida no se presentó la ocasión de usar la habilidad de River Ward')
  ok('en la partida se ha jugado una carta arrastrándola a la mesa', dragPlayed)
  ok('en la partida se ha pagado tocando Eddies y Legends (más de 1 €)', payChecked)
  if (!gearUnit || !gearLegend) console.log(`AVISO en esta partida no se presentó la ocasión de equipar un Gear a ${[!gearUnit && 'una Unidad', !gearLegend && 'una Legend'].filter(Boolean).join(' ni a ')}`)
  ok('sin errores de consola', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  ok('la prueba llega hasta el final', false, String(e).split('\n')[0])
} finally {
  await browser.close()
}

if (failures.length) {
  console.log(`\n${failures.length} comprobaciones fallan: ${failures.join('; ')}`)
  process.exitCode = 1
} else {
  console.log('\nTODO OK')
}

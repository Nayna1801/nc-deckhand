// Prueba de navegador del modo «Jugar contra el piloto» del Laboratorio. SOLO existe con `npm run dev` (no está en la web compilada),
// así que no forma parte de `npm run e2e`: arranca el servidor de desarrollo y lanza esto en otra terminal.
//
//   npm run dev                                  (en una terminal)
//   node e2e/lab-dev.mjs                         (en otra; 1920x1080 por defecto)
//   node e2e/lab-dev.mjs --size 1366x768 --url http://localhost:5173
//
// Comprueba: zoom al pasar el ratón, acciones de la carta tocada, arrastrar para vender / jugar / atacar, elegir con qué Legends se paga,
// que la mesa cabe sin desplazarse, que no hay desbordes ni errores de consola y que una partida entera se puede jugar con clics.
// Termina con código distinto de 0 si algo falla.
import { chromium } from 'playwright'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const URL = arg('url', 'http://localhost:5173')
const [W, H] = arg('size', '1920x1080').split('x').map(Number)
const MINE = '.pt-side.mine'
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
  await page.getByLabel('Tu mazo').selectOption('meta/bbg_control')
  await page.getByLabel('Mazo del piloto').selectOption('meta/red_aggro')
  await page.getByRole('button', { name: 'Empezar partida' }).click()
  await page.waitForSelector('.pt-actions', { timeout: 60_000 })
  await page.locator('.pt-opt', { hasText: /Quedarme/i }).click()
  await settle()
  await backToTurn()
  ok('empieza nuestro turno', /Tu turno/i.test(await title()), (await title()).slice(0, 40))

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
    if (/Pagas/i.test(await title())) {
      const legs = page.locator(`${MINE} .pt-zone[aria-label="Zona de Legends"] .pt-card.cand`)
      ok('al pagar se pueden marcar las Legends que se gastan', (await legs.count()) > 0, `${await legs.count()} listas`)
      await legs.first().click()
      ok('la Legend marcada se ilumina', (await page.locator(`${MINE} .pt-card.paid`).count()) === 1)
      ok('el panel dice lo que se gasta', /1 Legends/.test(await page.locator('.pt-pay-hint').innerText()))
      await page.locator('.pt-actions .pt-ap-end .pt-opt').click()
      await settle()
    }
    played = /juega/.test(await log())
  }
  ok('arrastrar una carta a la mesa la juega', played)
  await backToTurn()
  await page.locator('.pt-ap-end .pt-opt', { hasText: /Terminar/i }).click()
  await settle()

  // partida entera con clics (y un ataque arrastrando a los Gigs rival si se presenta)
  let attackDrag = false
  for (let step = 0; step < 400; step++) {
    if (await page.getByText('Repaso de la partida').count()) break
    const t = await title().catch(() => '')
    if (/Tu turno/i.test(t)) {
      const mine = page.locator(`${MINE} .pt-card.can`)
      let did = false
      const units = page.locator(`${MINE} .pt-field .pt-card.can`)
      if (!attackDrag && (await units.count())) {
        await units.first().click()
        if ((await page.locator('.pt-actions .pt-ap-block .pt-opt').allInnerTexts()).some((x) => /Atacar.*Gigs/i.test(x))) {
          attackDrag = true
          const before = (await log()).length
          await units.first().dragTo(page.locator('.pt-side.rival .pt-zone[aria-label="Zona de Gigs"]'))
          await settle()
          ok('arrastrar una Unidad a los Gigs rivales ataca', /ataca con/.test((await log()).slice(before)))
          did = true
        }
      }
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
      await page.locator('.pt-actions .pt-ap-block .pt-opt').first().click()
    } else {
      await page.locator('.pt-actions .pt-opt:not([disabled])').first().click()
    }
    await settle()
  }
  await page.waitForSelector('text=Repaso de la partida', { timeout: 60_000 })
  ok('se puede jugar una partida entera con clics y arrastres', true, await page.locator('.pb-result h3').innerText())
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

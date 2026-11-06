import { chromium } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BASE, CARDS } from '../config.mjs'
import { newSession } from '../lib/mock.mjs'

let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const byId = Object.fromEntries(CARDS.map((c) => [c.id, c]))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-scan-'))

/** Generador pseudoaleatorio con semilla (mulberry32): las "fotos" son siempre las mismas. */
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })

/* ---- el atlas publicado ---- */
const probe = await browser.newPage()
const atlas = await (await probe.request.get(BASE + 'scan/atlas.json')).json()
const atlasImg = await probe.request.get(BASE + 'scan/atlas.webp')
ok(atlas.refs.length > 300 && atlasImg.ok() && /image\/webp/.test(atlasImg.headers()['content-type'] ?? ''), `el atlas está publicado: ${atlas.refs.length} imágenes de referencia`)
const distinct = new Set(CARDS.flatMap((c) => [c.image, ...c.altArts.map((a) => a.image).filter(Boolean)]))
ok(atlas.refs.length <= distinct.size && atlas.refs.length > distinct.size - 20, `y cubre las imágenes del catálogo (${atlas.refs.length} distintas de ${distinct.size})`)
ok(atlas.refs.every((r) => byId[r.card] && fs.existsSync(path.join(process.cwd(), 'public', r.image))), 'cada referencia apunta a una carta e imagen que existen')

/** "Fotografía" una carta: giro, perspectiva, luz, tinte, reflejos, desenfoque y JPEG, renderizado por el propio navegador. */
async function photo(page, ref, r, { w = 400, h = 560, cardH = 470, quality = 65, hard = false } = {}) {
  const k = hard ? 2 : 1 // la tanda difícil multiplica los defectos de la foto
  const rot = (r() - 0.5) * 7 * k, bright = hard ? 0.5 + r() * 1.0 : 0.7 + r() * 0.6, contrast = hard ? 0.7 + r() * 0.6 : 0.85 + r() * 0.3, sat = hard ? 0.6 + r() * 0.8 : 0.8 + r() * 0.4, blur = r() * 1.2 * k
  const hue = (r() - 0.5) * 16 * k, tiltX = (r() - 0.5) * 8 * k, tiltY = (r() - 0.5) * 8 * k
  // la carta rara vez cae justo en el centro del marco: desplazamiento y escala (más en la tanda difícil)
  const dx = (r() - 0.5) * (hard ? 0.16 : 0.06) * w, dy = (r() - 0.5) * (hard ? 0.16 : 0.06) * h, zoom = hard ? 0.85 + r() * 0.27 : 0.95 + r() * 0.1
  const gx = r() * 100, gy = r() * 100, glare = r() < (hard ? 0.8 : 0.5) ? (hard ? 0.3 + r() * 0.5 : 0.15 + r() * 0.3) : 0
  const bg = Math.floor(15 + r() * 60)
  await page.setContent(`<body style="margin:0;background:rgb(${bg},${bg},${bg})">
    <div id="s" style="position:relative;width:${w}px;height:${h}px;overflow:hidden;background:rgb(${bg},${bg},${bg});display:flex;align-items:center;justify-content:center">
      <img id="c" src="${BASE}${ref.image}" style="height:${cardH}px;aspect-ratio:733/1024;transform:translate(${dx}px,${dy}px) scale(${zoom}) perspective(900px) rotate(${rot}deg) rotateX(${tiltX}deg) rotateY(${tiltY}deg);filter:brightness(${bright}) contrast(${contrast}) saturate(${sat}) hue-rotate(${hue}deg) blur(${blur}px)">
      <div style="position:absolute;inset:0;background:radial-gradient(circle at ${gx}% ${gy}%, rgba(255,255,255,${glare}) 0, rgba(255,255,255,0) 35%)"></div>
    </div></body>`)
  await page.waitForFunction(() => document.getElementById('c')?.complete && document.getElementById('c').naturalWidth > 0)
  return page.locator('#s').screenshot({ type: 'jpeg', quality })
}

const cardName = (ref) => byId[ref.card].displayName

/* ---- benchmark con el pipeline real del navegador: fotos subidas ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } })
  const studio = await ctx.newPage()
  const app = await ctx.newPage()
  app.setDefaultTimeout(10000)
  const errors = []
  app.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  await app.goto(BASE + '#/scan')
  await app.getByRole('button', { name: /Subir o hacer una foto/ }).waitFor()
  await app.waitForFunction(() => !document.body.innerText.includes('Preparando el escáner'))
  ok(await app.getByRole('button', { name: /Subir o hacer una foto/ }).isEnabled(), 'el escáner se prepara y deja de decir "Preparando…"')

  const run = async (label, hard, seed, minTop1, minTop3) => {
    const r = rng(seed)
    const pool = atlas.refs.map((x) => x).sort(() => r() - 0.5)
    const N = 40
    const sample = pool.slice(0, N)
    let top1 = 0, top3 = 0, cardTop3 = 0
    const misses = []
    const times = [] // milisegundos que tarda cada escaneo en el navegador
    const good = [], bad = [] // parecido de la 1ª candidata cuando acertó / cuando falló
    for (const ref of sample) {
      const jpg = await photo(studio, ref, r, { hard, quality: hard ? 40 : 65 })
      const before = Number((await app.locator('[data-scan]').first().getAttribute('data-scan').catch(() => '0')) ?? 0)
      await app.setInputFiles('input[type=file]', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: jpg })
      // espera a que este escaneo (y no el anterior) haya dejado sus resultados
      await app.waitForFunction((n) => Number(document.querySelector('[data-scan]')?.getAttribute('data-scan')) > n && document.querySelectorAll('.scan-result').length === 3, before)
      const rows = await app.locator('.scan-result .scan-info').evaluateAll((els) => els.map((e) => ({ name: e.querySelector('strong').innerText, art: e.querySelector('small').innerText.replace(/ · misma imagen.*$/, '') })))
      const artLabel = ref.art ? null : 'Diseño base'
      const same = (row) => row.name === cardName(ref) && (artLabel ? row.art === artLabel : row.art !== 'Diseño base')
      const score = parseInt(await app.locator('.scan-result .pill').first().innerText(), 10)
      times.push(Number(await app.locator('[data-ms]').first().getAttribute('data-ms')))
      ;(same(rows[0]) ? good : bad).push(score)
      ok(new Set(rows.map((x) => x.name)).size === 3, `las 3 candidatas son cartas distintas (${rows.map((x) => x.name).join(' | ')})`)
      if (same(rows[0])) top1++
      if (rows.some(same)) top3++
      else misses.push(`${cardName(ref)} [${ref.art ?? 'base'}] -> ${rows.map((x) => x.name).join(' | ')}`)
      if (rows.some((row) => row.name === cardName(ref))) cardTop3++
    }
    console.log(`  benchmark ${label} (${N} fotos simuladas): 1ª ${top1}/${N}, entre las 3 ${top3}/${N}, carta correcta entre las 3 ${cardTop3}/${N}`)
    console.log(`  parecido de la 1ª candidata: acertadas min ${Math.min(...good)} % / media ${Math.round(good.reduce((a, b) => a + b, 0) / Math.max(1, good.length))} %; falladas ${bad.length ? 'max ' + Math.max(...bad) + ' % / media ' + Math.round(bad.reduce((a, b) => a + b, 0) / bad.length) + ' %' : 'ninguna'}`)
    if (misses.length) console.log('  fallos:', misses.slice(0, 4).join(' || '))
    ok(Math.max(...times) < 1500, `${label}: cada escaneo tarda ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)} ms de media y como mucho ${Math.max(...times)} ms`)
    ok(top1 / N >= minTop1, `${label}: acierta a la primera en al menos el ${Math.round(minTop1 * 100)} % (${Math.round((top1 / N) * 100)} %)`)
    ok(top3 / N >= minTop3, `${label}: y entre las 3 candidatas en al menos el ${Math.round(minTop3 * 100)} % (${Math.round((top3 / N) * 100)} %)`)
  }
  await run('fotos normales', false, 20261106, 0.9, 0.95)
  await run('fotos difíciles (reflejos, giro, mala luz, JPEG fuerte, carta desplazada)', true, 20261107, 0.8, 0.9)
  ok(errors.length === 0, 'sin errores de página en el benchmark' + (errors.length ? ': ' + errors.join(' | ') : ''))
  await ctx.close()
}

/* ---- cámara simulada: un vídeo falso con una carta dentro del marco ---- */
{
  const target = atlas.refs.find((x) => cardName(x) === 'Goro Takemura: Hands Unclean' && !x.art) ?? atlas.refs[5]
  const tmpCtx = await browser.newContext({ viewport: { width: 640, height: 480 } })
  const studio = await tmpCtx.newPage()
  const frame = await photo(studio, target, rng(5), { w: 640, h: 480, cardH: 380, quality: 80 })
  await tmpCtx.close()
  const mjpeg = path.join(tmp, 'camara.mjpeg')
  fs.writeFileSync(mjpeg, Buffer.concat(Array.from({ length: 40 }, () => frame)))

  const camBrowser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${mjpeg}`] })
  const ctx = await camBrowser.newContext({ viewport: { width: 900, height: 760 }, permissions: ['camera'] })
  const p = await ctx.newPage()
  p.setDefaultTimeout(10000)
  const errors = []
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  await p.goto(BASE)
  await p.waitForSelector('.tile')
  await p.getByRole('link', { name: /Escanear/ }).click()
  await p.waitForURL(/#\/scan/)
  await p.getByRole('heading', { name: /Escanear carta/ }).waitFor()
  ok(true, 'desde Cartas se llega al escáner')
  ok(await p.locator('.scan-stage').isHidden(), 'la cámara no se enciende sola')
  await p.getByRole('button', { name: /Activar cámara/ }).click()
  await p.locator('.scan-guide').waitFor()
  await p.waitForFunction(() => document.querySelector('.scan-stage video')?.videoWidth > 0)
  const geo = await p.evaluate(() => { const v = document.querySelector('.scan-stage video').getBoundingClientRect(); const g = document.querySelector('.scan-guide').getBoundingClientRect(); return { vw: v.width, vh: v.height, gw: g.width, gh: g.height, gx: g.x - v.x, gy: g.y - v.y } })
  ok(Math.abs(geo.gw / geo.gh - 5 / 7) < 0.02 && Math.abs(geo.gx + geo.gw / 2 - geo.vw / 2) < 2 && Math.abs(geo.gy + geo.gh / 2 - geo.vh / 2) < 2, 'el marco guía tiene forma de carta (5:7) y está centrado sobre el vídeo')
  // al activar la cámara la página se desplaza hasta que el visor llena la pantalla
  await p.waitForFunction(() => { const r = document.querySelector('.scan-stage').getBoundingClientRect(); return r.top >= 0 && r.top < 110 })
  const view = await p.evaluate(() => { const r = document.querySelector('.scan-stage').getBoundingClientRect(); const b = document.querySelector('.scan-shot').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight, scrollY, btnTop: b.top, btnBottom: b.bottom } })
  ok(view.scrollY > 0 && view.top >= 0 && view.top < 110, `la página se desplaza hasta el visor (scroll ${Math.round(view.scrollY)}px, el visor empieza a ${Math.round(view.top)}px del borde)`)
  ok(view.bottom <= view.vh + 1, `el visor cabe entero en la pantalla (termina a ${Math.round(view.bottom)}px de ${view.vh}px)`)
  ok(view.btnTop >= 0 && view.btnBottom <= view.vh, 'el botón Escanear queda a la vista, sobre el visor, sin tener que desplazarse')
  await p.getByRole('button', { name: 'Escanear', exact: true }).click()
  await p.locator('.scan-result').first().waitFor()
  await p.waitForFunction(() => { const r = document.querySelector('.scan-results').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })
  ok(true, 'al escanear, la página baja sola y deja las 3 candidatas enteras a la vista')
  await p.getByRole('button', { name: /Escanear otra/ }).click()
  await p.waitForFunction(() => { const r = document.querySelector('.scan-stage').getBoundingClientRect(); return r.top >= 0 && r.top < 110 })
  ok(true, '«Escanear otra» devuelve al visor')
  await p.getByRole('button', { name: 'Escanear', exact: true }).click()
  await p.waitForFunction(() => document.querySelector('.scan-results-box')?.getAttribute('data-scan') === '2')
  const first = await p.locator('.scan-result .scan-info strong').first().innerText()
  const all = await p.locator('.scan-result .scan-info strong').allInnerTexts()
  ok(first === cardName(target) || all.includes(cardName(target)), `con la cámara reconoce la carta (1ª: ${first}; esperada: ${cardName(target)})`)
  ok(all.length === 3, 'siempre ofrece 3 candidatas')
  ok((await p.locator('.scan-result .pill').first().innerText()).includes('%'), 'cada candidata muestra su parecido')
  // «Es esta» abre el detalle y apunta el acierto
  await p.locator('.scan-result').filter({ hasText: cardName(target) }).first().getByRole('button', { name: 'Es esta' }).click()
  await p.locator('.modal').waitFor()
  ok(/Goro Takemura/.test(await p.locator('.modal h2').innerText()), 'se abre el detalle de la carta correcta')
  ok(/Inicia sesión/.test(await p.locator('.modal').innerText()), 'sin sesión el detalle invita a iniciar sesión para añadirla')
  await p.keyboard.press('Escape')
  await p.locator('.scan-stats summary').click()
  const statsText = await p.locator('.scan-stats').innerText()
  ok(/1 escaneo/.test(statsText) && /100 %/.test(statsText), `se apunta el acierto en las estadísticas ("${statsText.replace(/\s+/g, ' ').slice(0, 110)}")`)
  await p.reload()
  await p.locator('.scan-stats summary').click()
  ok(/1 escaneo/.test(await p.locator('.scan-stats').innerText()), 'las estadísticas se conservan al recargar')
  await p.getByRole('button', { name: 'Borrar estadísticas' }).click()
  ok(/0 escaneos/.test(await p.locator('.scan-stats').innerText()), 'y se pueden borrar')
  await p.getByRole('button', { name: /Activar cámara/ }).click()
  await p.locator('.scan-guide').waitFor()
  await p.getByRole('button', { name: 'Apagar cámara' }).click()
  ok(await p.locator('.scan-stage').isHidden(), 'se puede apagar la cámara')
  const live = await p.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.srcObject).length)
  ok(live === 0, 'al apagarla se libera el vídeo (no queda ninguna pista activa)')
  ok(errors.length === 0, 'sin errores de página con la cámara' + (errors.length ? ': ' + errors.join(' | ') : ''))
  await ctx.close()
  await camBrowser.close()
}

/* ---- errores: sin cámara, sin soporte y archivo que no es imagen ---- */
{
  const plain = await chromium.launch() // sin cámara falsa: no hay dispositivo
  const ctx = await plain.newContext({ viewport: { width: 900, height: 900 } })
  const p = await ctx.newPage()
  p.setDefaultTimeout(10000)
  await p.goto(BASE + '#/scan')
  await p.getByRole('button', { name: /Activar cámara/ }).click()
  await p.locator('[role=alert]').first().waitFor()
  ok(/cámara/i.test(await p.locator('[role=alert]').first().innerText()), `sin cámara muestra un mensaje claro ("${(await p.locator('[role=alert]').first().innerText()).slice(0, 70)}")`)
  ok(await p.locator('.scan-stage').isHidden(), 'y no deja la vista de cámara a medias')
  await p.waitForFunction(() => !document.body.innerText.includes('Preparando el escáner'))
  await p.setInputFiles('input[type=file]', { name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('esto no es una imagen') })
  await p.getByText(/No se pudo leer esa imagen/).waitFor()
  ok(true, 'un archivo que no es una imagen se rechaza con un mensaje')
  await ctx.close()

  const ctx2 = await plain.newContext({ viewport: { width: 900, height: 900 } })
  await ctx2.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true }) })
  const q = await ctx2.newPage()
  await q.goto(BASE + '#/scan')
  await q.getByRole('button', { name: /Activar cámara/ }).click()
  await q.getByText(/no permite usar la cámara/).waitFor()
  ok(await q.getByRole('button', { name: /Subir o hacer una foto/ }).isVisible(), 'si el navegador no soporta la cámara, ofrece subir una foto')
  await ctx2.close()
  await plain.close()
}

/* ---- con sesión: añadir la carta escaneada a la colección ---- */
{
  const s = await newSession(browser, { legacy: false })
  const p = s.page
  p.setDefaultTimeout(10000)
  const ref = atlas.refs.find((x) => cardName(x) === 'Saul Bright: Stormrider' && !x.art) ?? atlas.refs[9]
  const studio = await (await browser.newContext({ viewport: { width: 900, height: 900 } })).newPage()
  const jpg = await photo(studio, ref, rng(11))
  await p.goto(BASE + '#/scan')
  await p.waitForFunction(() => !document.body.innerText.includes('Preparando el escáner'))
  await p.setInputFiles('input[type=file]', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: jpg })
  await p.locator('.scan-result').first().waitFor()
  await p.locator('.scan-result').filter({ hasText: cardName(ref) }).first().getByRole('button', { name: 'Es esta' }).click()
  const modal = p.locator('.modal'); await modal.waitFor()
  await modal.locator('.inventory .row', { hasText: 'Normal' }).getByRole('button', { name: 'Añadir uno' }).click()
  await p.waitForTimeout(500)
  ok(s.store.collection.get(ref.card)?.quantity === 1, `con sesión se añade la carta escaneada a la colección (${ref.card})`)
}

await browser.close()
fs.rmSync(tmp, { recursive: true, force: true })
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
process.exit(failed ? 1 : 0)

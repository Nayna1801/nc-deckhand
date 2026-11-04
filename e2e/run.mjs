#!/usr/bin/env node
/**
 * Lanzador de las pruebas de navegador (Playwright).
 *
 *   npm run e2e                  compila una copia de pruebas, la sirve y pasa todas las suites
 *   npm run e2e:live             pasa las suites contra la web publicada
 *   node e2e/run.mjs --only stepper,guest      solo esas suites
 *   node e2e/run.mjs --list                    lista las suites
 *   node e2e/run.mjs --no-build                reutiliza dist-e2e si ya existe
 *   node e2e/run.mjs --url https://…/          otra dirección
 *
 * Las suites simulan Supabase interceptando la red: nunca tocan una base de datos real.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { DIST_E2E, LIVE_URL, ROOT, SHOTS } from './config.mjs'

const SUITES = [
  { name: 'guest', file: 'guest.mjs', info: 'invitado: catálogo, constructor, arrastrar y soltar, compartir, móvil' },
  { name: 'search', file: 'search.mjs', info: 'búsqueda con sintaxis y variantes' },
  { name: 'sticky', file: 'sticky.mjs', info: 'filtro "me faltan" estable y página de Colección' },
  { name: 'logged', file: 'logged.mjs', info: 'con sesión: inventario, bulk y listas de compra' },
  { name: 'features', file: 'features.mjs', info: 'orden por sets, filtros, desplegables, deseos, móvil y seguridad' },
  { name: 'fixes', file: 'fixes.mjs', info: 'modal estable, playset por tipo, versiones y − sobre el total' },
  { name: 'altart', file: 'altart.mjs', info: 'galería de artes alternativos' },
  { name: 'auth', file: 'auth.mjs', info: 'alta, confirmación de email y vuelta desde el enlace' },
  { name: 'stepper', file: 'stepper.mjs', info: '+ y − con latencia, orden de escrituras y carga lenta' },
  { name: 'version', file: 'version.mjs', info: 'sello de versión y aviso de versión nueva', localOnly: true },
]

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const value = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)
const live = flag('--live') || value('--url') !== undefined
const only = value('--only')?.split(',').map((s) => s.trim())

if (flag('--list')) {
  for (const s of SUITES) console.log(`${s.name.padEnd(9)} ${s.info}${s.localOnly ? ' (solo local)' : ''}`)
  process.exit(0)
}

const run = (cmd, argv, env = {}, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, argv, { cwd: ROOT, env: { ...process.env, ...env }, stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true })
    let out = ''
    child.stdout?.on('data', (d) => (out += d))
    child.stderr?.on('data', (d) => (out += d))
    child.on('close', (code) => resolve({ code: code ?? 1, out }))
  })

const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)) }) })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return true
    } catch { /* aún arrancando */ }
    await wait(250)
  }
  return false
}

/** Proyecto de Supabase que usa la web publicada: se lee de su propio código, para interceptar la dirección correcta. */
async function detectLiveSupabase(base) {
  try {
    const html = await (await fetch(base)).text()
    const script = html.match(/src="(\.?\/?assets\/index-[^"]+\.js)"/)?.[1]
    if (!script) return undefined
    const js = await (await fetch(new URL(script, base))).text()
    return js.match(/https:\/\/[a-z0-9]{8,}\.supabase\.co/)?.[0]
  } catch {
    return undefined
  }
}

// ---- requisitos
if (!existsSync(chromium.executablePath())) {
  console.error('Falta el navegador de pruebas. Instálalo una vez con:\n\n  npx playwright install chromium\n')
  process.exit(2)
}

let server
let base = value('--url') ?? (live ? LIVE_URL : '')
const env = { E2E_SHOTS: SHOTS }

if (!live) {
  // Copia de pruebas apuntando a un proyecto de Supabase FALSO (la red se simula en las suites)
  env.E2E_SUPABASE_URL = 'https://e2e-test.supabase.co'
  if (!flag('--no-build') || !existsSync(DIST_E2E)) {
    console.log('▸ Compilando la copia de pruebas…')
    const b = await run(process.execPath, [vite, 'build', '--outDir', DIST_E2E, '--emptyOutDir', '--logLevel', 'warn'], {
      VITE_SUPABASE_URL: env.E2E_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: 'e2e-test-key',
    })
    if (b.code !== 0) process.exit(b.code)
  }
  const port = await freePort()
  base = `http://localhost:${port}/`
  server = spawn(process.execPath, [vite, 'preview', '--outDir', DIST_E2E, '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore', windowsHide: true })
  if (!(await waitForHttp(base))) {
    server.kill()
    console.error('No arrancó el servidor de pruebas.')
    process.exit(1)
  }
} else {
  const host = process.env.E2E_SUPABASE_URL || (await detectLiveSupabase(base))
  if (host) env.E2E_SUPABASE_URL = host
  else console.warn('⚠ No se pudo detectar el proyecto de Supabase de la web: las suites con sesión pueden fallar.')
}

console.log(`▸ Probando ${base}\n`)
const chosen = SUITES.filter((s) => (!only || only.includes(s.name)) && !(live && s.localOnly))
const results = []
for (const s of chosen) {
  const t0 = Date.now()
  const r = await run(process.execPath, [join(ROOT, 'e2e', 'suites', s.file)], { ...env, BASE: base }, { capture: true })
  const pass = (r.out.match(/^PASS /gm) ?? []).length
  const fails = r.out.split('\n').filter((l) => l.startsWith('FAIL '))
  results.push({ ...s, pass, fails, code: r.code, secs: ((Date.now() - t0) / 1000).toFixed(1), out: r.out })
  const ok = r.code === 0 && fails.length === 0
  console.log(`${ok ? '✔' : '✘'} ${s.name.padEnd(9)} ${String(pass).padStart(3)} ok${fails.length ? `, ${fails.length} FALLAN` : ''}  (${results.at(-1).secs}s)`)
  for (const f of fails) console.log(`     ${f}`)
  if (!ok && fails.length === 0) console.log(r.out.split('\n').filter(Boolean).slice(-8).map((l) => '     ' + l).join('\n'))
}

server?.kill()
const total = results.reduce((a, r) => a + r.pass, 0)
const bad = results.filter((r) => r.code !== 0 || r.fails.length > 0)
console.log(`\n${bad.length === 0 ? '✔ TODO OK' : `✘ ${bad.length} suite(s) con fallos`} — ${total} comprobaciones en ${results.length} suites`)
console.log(`Capturas de pantalla: ${SHOTS}`)
process.exit(bad.length === 0 ? 0 : 1)

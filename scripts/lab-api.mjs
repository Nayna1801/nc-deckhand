// Plugin de Vite SOLO para `npm run dev` (apply: 'serve'): da a la página «Laboratorio» acceso al simulador de Python.
// No existe en la web compilada ni publicada. Rutas (solo localhost, el servidor de desarrollo no se expone):
//   GET  /__lab/decks      -> mazos de tools/deckforge/decks y meta
//   POST /__lab/simulate   -> {a, b, seed, deep} -> partida grabada paso a paso
//   POST /__lab/play       -> {cmd: start|answer|abort|decks, ...} -> siguiente mensaje de una partida en vivo contra el piloto
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.resolve(HERE, '../tools/deckforge/lab_sim.py')
const PLAY_SCRIPT = path.resolve(HERE, '../tools/deckforge/lab_play.py')
const PLAY_COMMANDS = new Set(['start', 'answer', 'abort', 'decks'])
const PYTHON = process.env.NCD_PYTHON || 'python'
const MAX_BODY = 300_000
const TIMEOUT_MS = 90_000

/** Ejecuta lab_sim.py (sin shell: los datos van por stdin, nunca en la línea de comandos). */
function runPython(command, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, ['-I', SCRIPT, command], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`El simulador tardó más de ${TIMEOUT_MS / 1000} s`))
    }, TIMEOUT_MS)
    child.stdout.setEncoding('utf8').on('data', (d) => (out += d))
    child.stderr.setEncoding('utf8').on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`No se pudo ejecutar «${PYTHON}»: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(Object.assign(new Error(err.trim().split('\n').pop() || `python salió con código ${code}`), { status: code === 2 ? 400 : 500 }))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

// Partida en vivo: UN proceso de Python que sigue vivo entre peticiones (la partida vive en él) y habla JSON por líneas.
// Las peticiones se atienden de una en una, en orden.
let bridge = null
let queue = Promise.resolve()

function startBridge() {
  const child = spawn(PYTHON, ['-I', PLAY_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] })
  const b = { child, buf: '', err: '', waiting: null }
  child.stdout.setEncoding('utf8').on('data', (d) => {
    b.buf += d
    for (let i = b.buf.indexOf('\n'); i >= 0; i = b.buf.indexOf('\n')) {
      const line = b.buf.slice(0, i)
      b.buf = b.buf.slice(i + 1)
      if (line.trim() && b.waiting) {
        const w = b.waiting
        b.waiting = null
        clearTimeout(w.timer)
        w.resolve(line)
      }
    }
  })
  child.stderr.setEncoding('utf8').on('data', (d) => (b.err += d))
  const fail = (msg) => {
    if (bridge === b) bridge = null
    if (b.waiting) {
      const w = b.waiting
      b.waiting = null
      clearTimeout(w.timer)
      w.reject(new Error(msg))
    }
  }
  child.on('error', (e) => fail(`No se pudo ejecutar «${PYTHON}»: ${e.message}`))
  child.on('close', (code) => fail(b.err.trim().split('\n').pop() || `la partida se cerró (código ${code})`))
  child.stdin.on('error', () => {})
  return b
}

function exchange(line) {
  return new Promise((resolve, reject) => {
    bridge ??= startBridge()
    const b = bridge
    const timer = setTimeout(() => {
      b.child.kill()
      reject(new Error(`El piloto tardó más de ${TIMEOUT_MS / 1000} s en responder`))
    }, TIMEOUT_MS)
    b.waiting = { resolve, reject, timer }
    b.child.stdin.write(line + '\n')
  })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Petición demasiado grande'), { status: 413 }))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

export default function labApi() {
  return {
    name: 'nc-lab-api',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.on('close', () => bridge?.child.kill())
      server.middlewares.use('/__lab/play', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' })
        try {
          const cmd = JSON.parse(await readBody(req))
          if (!cmd || typeof cmd !== 'object' || !PLAY_COMMANDS.has(cmd.cmd)) throw Object.assign(new Error('Orden no válida'), { status: 400 })
          const line = JSON.stringify(cmd) // una sola línea: JSON.stringify escapa los saltos de línea
          const run = queue.then(() => exchange(line))
          queue = run.catch(() => {})
          send(res, 200, await run)
        } catch (e) {
          send(res, e.status ?? (e instanceof SyntaxError ? 400 : 500), { error: e.message })
        }
      })
      server.middlewares.use('/__lab/decks', async (req, res) => {
        if (req.method !== 'GET') return send(res, 405, { error: 'Método no permitido' })
        try {
          send(res, 200, await runPython('decks'))
        } catch (e) {
          send(res, e.status ?? 500, { error: e.message })
        }
      })
      server.middlewares.use('/__lab/simulate', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' })
        try {
          const body = await readBody(req)
          JSON.parse(body) // si no es JSON, falla aquí con un mensaje claro y no llega a Python
          send(res, 200, await runPython('simulate', body))
        } catch (e) {
          send(res, e.status ?? (e instanceof SyntaxError ? 400 : 500), { error: e.message })
        }
      })
    },
  }
}

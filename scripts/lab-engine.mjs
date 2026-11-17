// Plugin de Vite: lleva el simulador de Python (tools/deckforge) a la web para que el «Laboratorio» funcione sin servidor.
// El motor corre en el navegador con Pyodide (Python compilado a WebAssembly) dentro de un Worker: src/lab/engine.worker.ts.
//
// Publica, tanto al compilar como en `npm run dev`:
//   pyodide/…          los 5 ficheros de Pyodide (≈12 MB), copiados de node_modules: mismo origen, sin CDN (la CSP solo admite 'self')
//   lab/engine.json    {files: {ruta: texto}} con los módulos de Python del motor y sus datos, con las mismas rutas que en el repo
//
// Nada de esto se guarda en git: sale de node_modules y de tools/deckforge en cada compilación.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PYODIDE_DIR = path.join(ROOT, 'node_modules', 'pyodide')
const PYODIDE_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
const FORGE = 'tools/deckforge'

/** Módulos que hacen falta para simular y para jugar contra el piloto (no las herramientas de análisis ni las pruebas). */
const MODULES = [
  'ai2', 'ai2_cards', 'ai2_dice', 'ai2_react', 'ai2_setup', 'ai2_turn', 'cardsdb', 'engine2', 'fx2', 'fx2_base', 'fx2_programs',
  'fx2_rules', 'fx2_units', 'human', 'human_pilot', 'human_react', 'lab_play', 'lab_sim', 'lab_web', 'live', 'replay', 'valfn',
]
/** Carpetas de datos: solo sus .json de primer nivel (data/human/, con las partidas de quien juega en local, queda fuera). */
const DATA_DIRS = ['data', 'decks', 'meta']

const MIME = { '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.zip': 'application/zip', '.json': 'application/json' }

export function engineFiles() {
  const rel = [
    ...MODULES.map((m) => `${FORGE}/${m}.py`),
    ...DATA_DIRS.flatMap((d) => fs.readdirSync(path.join(ROOT, FORGE, d)).filter((f) => f.endsWith('.json')).sort().map((f) => `${FORGE}/${d}/${f}`)),
    'src/data/cards.json',
  ]
  return Object.fromEntries(rel.map((r) => [r, fs.readFileSync(path.join(ROOT, r), 'utf8').replace(/\r\n/g, '\n')]))
}

const engineJson = () => JSON.stringify({ files: engineFiles() })

function pyodideFile(name) {
  const file = path.join(PYODIDE_DIR, name)
  if (!fs.existsSync(file)) throw new Error(`Falta ${file}: ejecuta «npm install» (pyodide es una dependencia de desarrollo)`)
  return fs.readFileSync(file)
}

export default function labEngine() {
  return {
    name: 'nc-lab-engine',
    generateBundle() {
      for (const name of PYODIDE_FILES) this.emitFile({ type: 'asset', fileName: `pyodide/${name}`, source: pyodideFile(name) })
      this.emitFile({ type: 'asset', fileName: 'lab/engine.json', source: engineJson() })
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        try {
          if (url === '/lab/engine.json') {
            res.setHeader('Content-Type', MIME['.json'])
            res.setHeader('Cache-Control', 'no-store')
            return res.end(engineJson())
          }
          const name = url.startsWith('/pyodide/') ? url.slice('/pyodide/'.length) : ''
          if (PYODIDE_FILES.includes(name)) {
            res.setHeader('Content-Type', MIME[path.extname(name)])
            return res.end(pyodideFile(name))
          }
        } catch (e) {
          res.statusCode = 500
          return res.end(String(e.message))
        }
        next()
      })
    },
  }
}

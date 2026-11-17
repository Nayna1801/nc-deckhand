/**
 * Worker del Laboratorio: ejecuta el simulador de Python (tools/deckforge) dentro del navegador con Pyodide, fuera del hilo de la
 * página para que la pantalla no se quede congelada mientras el piloto piensa. Lo usa src/lib/labEngine.ts.
 *
 * Mensajes que recibe:  {init: {base}}  una vez, con la dirección de la web;  {id, req}  una petición para lab_web.handle
 * Mensajes que envía:   {status}  (loading → starting → ready | error, con `message`);  {id, res}  la respuesta, ya como objeto
 *
 * Pyodide y el motor se sirven desde la propia web (scripts/lab-engine.mjs los publica en pyodide/ y lab/engine.json).
 */
import type { EngineStatus, WorkerInbound, WorkerOutbound } from '../lib/labEngine'

interface PyModule {
  handle(text: string): string
  idle(): boolean
}

interface Pyodide {
  FS: { mkdirTree(dir: string): void; writeFile(file: string, text: string): void }
  runPython(code: string): unknown
  pyimport(name: string): unknown
}

const APP_DIR = '/app' // dentro del sistema de ficheros en memoria de Pyodide; debajo, las mismas rutas que en el repo
const ctx = self as unknown as { postMessage(m: WorkerOutbound): void; onmessage: ((e: MessageEvent<WorkerInbound>) => void) | null }

let engine: Promise<PyModule> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null

const status = (s: EngineStatus, message?: string) => ctx.postMessage({ status: s, message })

async function boot(base: string): Promise<PyModule> {
  status('loading')
  const [mod, bundle] = await Promise.all([
    import(/* @vite-ignore */ `${base}pyodide/pyodide.mjs`) as Promise<{ loadPyodide(o: { indexURL: string }): Promise<Pyodide> }>,
    fetch(`${base}lab/engine.json?v=${__APP_VERSION__}`).then((r) => {
      if (!r.ok) throw new Error(`no se pudo descargar el motor (error ${r.status})`)
      return r.json() as Promise<{ files: Record<string, string> }>
    }),
  ])
  const py = await mod.loadPyodide({ indexURL: `${base}pyodide/` })
  status('starting')
  const dirs = new Set<string>()
  for (const [rel, text] of Object.entries(bundle.files)) {
    const file = `${APP_DIR}/${rel}`
    const dir = file.slice(0, file.lastIndexOf('/'))
    if (!dirs.has(dir)) {
      py.FS.mkdirTree(dir)
      dirs.add(dir)
    }
    py.FS.writeFile(file, text)
  }
  py.runPython(`import sys\nsys.path.insert(0, '${APP_DIR}/tools/deckforge')`)
  const web = py.pyimport('lab_web') as PyModule
  status('ready')
  return web
}

/** Mientras la persona piensa, el motor adelanta trabajo (lo que habría hecho el piloto en su turno). Entre paso y paso se atienden
 *  los mensajes que hayan llegado. */
function idleSoon(web: PyModule) {
  if (idleTimer !== null) return
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (web.idle()) idleSoon(web)
  }, 0)
}

ctx.onmessage = (e) => {
  const msg = e.data
  if ('init' in msg) {
    engine = boot(msg.init.base)
    engine.catch((err: unknown) => status('error', err instanceof Error ? err.message : String(err)))
    return
  }
  const { id, req } = msg
  if (!engine) return ctx.postMessage({ id, error: 'el motor no se ha iniciado' })
  engine.then(
    (web) => {
      try {
        ctx.postMessage({ id, res: JSON.parse(web.handle(JSON.stringify(req))) as unknown })
        idleSoon(web)
      } catch (err: unknown) {
        ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
      }
    },
    (err: unknown) => ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) }),
  )
}

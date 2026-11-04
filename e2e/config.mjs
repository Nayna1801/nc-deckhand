// Configuración común de las pruebas de navegador (Playwright).
// La mayoría de valores llegan por variables de entorno que pone el lanzador (e2e/run.mjs).
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Dirección de la web que se prueba (la pone el lanzador). */
export const BASE = process.env.BASE || 'http://localhost:4173/'

/** Web publicada, para `npm run e2e:live`. */
export const LIVE_URL = 'https://nayna1801.github.io/nc-deckhand/'

/**
 * Proyecto de Supabase que "habla" la web bajo prueba. En local el lanzador compila la web contra un proyecto
 * FALSO y las pruebas interceptan toda la red: no se usan credenciales reales ni se toca ninguna base de datos.
 */
export const SUPABASE_HOST = process.env.E2E_SUPABASE_URL || 'https://e2e-test.supabase.co'
export const SUPABASE_REF = new URL(SUPABASE_HOST).hostname.split('.')[0]

/** Carpeta de capturas de pantalla (por defecto la temporal del sistema; no se guarda nada en el repo). */
export const SHOTS = process.env.E2E_SHOTS || join(tmpdir(), 'nc-deckhand-e2e')
mkdirSync(SHOTS, { recursive: true })

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))

/** Catálogo de cartas de la app (para calcular los resultados esperados a partir de los datos reales). */
export const CARDS = readJson('src/data/cards.json')

/** Mazos reales de ejemplo, anonimizados (los mismos que usan los tests de lógica). */
export const DECKS = readJson('src/lib/__fixtures__/siteDecks.json')

/** Carpeta del último build de pruebas. */
export const DIST_E2E = join(ROOT, 'dist-e2e')

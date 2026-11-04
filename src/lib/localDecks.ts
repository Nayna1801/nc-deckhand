import { catalog as defaultCatalog, isCardId, type Catalog } from './catalog'
import type { Deck, Quantities } from './types'

const KEY = 'ncd.guestDecks.v1'
const MAX_DECKS = 200
const MAX_QTY = 99
const ID_RE = /^[\w-]{8,64}$/

function cleanQuantities(v: unknown, cat: Catalog): Quantities {
  const out: Quantities = {}
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out
  for (const [id, n] of Object.entries(v)) {
    if (!isCardId(id, cat)) continue
    const q = Math.floor(Number(n))
    if (Number.isFinite(q) && q > 0) out[id] = Math.min(q, MAX_QTY)
  }
  return out
}

/** Los datos del navegador se pueden editar a mano o corromperse: nunca se confía en su forma. */
export function sanitizeDecks(raw: unknown, cat: Catalog = defaultCatalog): Deck[] {
  if (!Array.isArray(raw)) return []
  const decks: Deck[] = []
  for (const item of raw.slice(0, MAX_DECKS)) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const d = item as Record<string, unknown>
    // sin ninguno de los campos propios de un mazo no es un mazo
    if (typeof d.name !== 'string' && !Array.isArray(d.legendIds) && typeof d.main !== 'object') continue
    const legends = Array.isArray(d.legendIds) ? [...new Set(d.legendIds.filter((x): x is string => isCardId(x, cat)))].slice(0, 3) : []
    const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 64) : 'Mazo'
    const stamp = typeof d.updatedAt === 'string' && !Number.isNaN(Date.parse(d.updatedAt)) ? d.updatedAt : new Date().toISOString()
    decks.push({
      id: typeof d.id === 'string' && ID_RE.test(d.id) ? d.id : crypto.randomUUID(),
      name,
      legendIds: legends,
      main: cleanQuantities(d.main, cat),
      side: cleanQuantities(d.side, cat),
      updatedAt: stamp,
    })
  }
  return decks
}

export function loadLocalDecks(): Deck[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? sanitizeDecks(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function saveLocalDecks(decks: Deck[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(decks))
  } catch {
    // almacenamiento lleno o bloqueado: la UI sigue funcionando en memoria
  }
}

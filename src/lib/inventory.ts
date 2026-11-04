import { toCsv } from './csv'

export const CONDITIONS = ['mint', 'played', 'damaged'] as const
export type Condition = (typeof CONDITIONS)[number]

export const CONDITION_LABEL: Record<Condition, string> = { mint: 'Mint', played: 'Played', damaged: 'Damaged' }

export const PLAYSET = 3

/** Copias de una carta que tiene el usuario, por versión. */
export interface InventoryEntry {
  normal: number
  foil: number
  promo: number
  /** Estado de las copias destinadas a cambio o venta (bulk). */
  condition: Condition
}

export type Inventory = Record<string, InventoryEntry>

export const EMPTY_ENTRY: InventoryEntry = { normal: 0, foil: 0, promo: 0, condition: 'mint' }

export const totalOf = (e: Pick<InventoryEntry, 'normal' | 'foil' | 'promo'> | undefined): number =>
  e ? e.normal + e.foil + e.promo : 0

/**
 * Algoritmo de playset: hasta 3 copias van a la "Colección activa"; de la 4ª en adelante pasan al Bulk.
 * Se calcula siempre a partir del total, así nunca se desincroniza.
 */
export function splitPlayset(total: number): { active: number; bulk: number } {
  const t = Math.max(0, Math.floor(total))
  return { active: Math.min(PLAYSET, t), bulk: Math.max(0, t - PLAYSET) }
}

/** Cantidades totales por carta (suma de versiones), que es lo que usan las reglas de mazo. */
export function totalsByCard(inv: Inventory): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, e] of Object.entries(inv)) {
    const t = totalOf(e)
    if (t > 0) out[id] = t
  }
  return out
}

export function sanitizeEntry(e: Partial<InventoryEntry>): InventoryEntry {
  const n = (v: unknown) => Math.max(0, Math.min(999, Math.floor(Number(v) || 0)))
  return {
    normal: n(e.normal),
    foil: n(e.foil),
    promo: n(e.promo),
    condition: CONDITIONS.includes(e.condition as Condition) ? (e.condition as Condition) : 'mint',
  }
}

export interface BulkRow {
  cardId: string
  bulk: number
  total: number
  condition: Condition
}

export function bulkList(inv: Inventory): BulkRow[] {
  return Object.entries(inv)
    .map(([cardId, e]) => ({ cardId, total: totalOf(e), bulk: splitPlayset(totalOf(e)).bulk, condition: e.condition }))
    .filter((r) => r.bulk > 0)
}

/** Lista de bulk para cambio/venta: una fila por carta con copias sobrantes y su estado. */
export function bulkToCsv(rows: BulkRow[], names: (cardId: string) => { code: string; name: string; set: string }): string {
  return toCsv(
    ['code', 'name', 'set', 'bulk_copies', 'condition'],
    rows.map((r) => {
      const n = names(r.cardId)
      return [n.code, n.name, n.set, r.bulk, CONDITION_LABEL[r.condition]]
    }),
  )
}

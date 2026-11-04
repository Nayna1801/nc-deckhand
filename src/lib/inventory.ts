import { toCsv } from './csv'
import type { Card } from './types'

export const CONDITIONS = ['mint', 'played', 'damaged'] as const
export type Condition = (typeof CONDITIONS)[number]

export const CONDITION_LABEL: Record<Condition, string> = { mint: 'Mint', played: 'Played', damaged: 'Damaged' }

export const PLAYSET = 3

/**
 * Copias que forman el "playset" de una carta: lo máximo que se lleva en un mazo.
 * Una Legend se lleva una sola vez por mazo (y no puede repetirse por nombre), así que su playset es 1.
 */
export const playsetSize = (card: Pick<Card, 'type'> | undefined): number => (card?.type === 'Legend' ? 1 : PLAYSET)

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
 * Algoritmo de playset: las primeras `size` copias forman el playset; lo que pasa de ahí es Bulk.
 * Se calcula siempre a partir del total, así nunca se desincroniza.
 */
export function splitPlayset(total: number, size: number = PLAYSET): { active: number; bulk: number } {
  const t = Math.max(0, Math.floor(total))
  return { active: Math.min(size, t), bulk: Math.max(0, t - size) }
}

/**
 * Ajusta el TOTAL de copias de una carta. Sumar añade una Normal; restar quita primero las Normales y,
 * si no quedan, las Promo y por último las Foil (las más valiosas se conservan hasta el final).
 */
export function adjustCopies(entry: InventoryEntry, delta: number): InventoryEntry {
  if (delta >= 0) return sanitizeEntry({ ...entry, normal: entry.normal + delta })
  const out = { ...entry }
  let left = -delta
  for (const k of ['normal', 'promo', 'foil'] as const) {
    const take = Math.min(out[k], left)
    out[k] -= take
    left -= take
    if (left === 0) break
  }
  return sanitizeEntry(out)
}

const PROMO_SET = /promo|judge|topper/i

/**
 * Qué versiones existen para una carta según el catálogo. Normal existe siempre.
 * El catálogo de origen no trae ningún dato de foil, así que solo se ofrece si alguna impresión lo indica.
 */
export function availableVersions(card: Card): { foil: boolean; promo: boolean } {
  const promo = card.altArts.length > 0 || card.printings.some((p) => PROMO_SET.test(`${p.baseSetName} ${p.edition ?? ''}`))
  const foil = [...card.printings, ...card.altArts].some((x) => /foil/i.test(x.finish ?? ''))
  return { foil, promo }
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

export function bulkList(inv: Inventory, sizeOf: (cardId: string) => number = () => PLAYSET): BulkRow[] {
  return Object.entries(inv)
    .map(([cardId, e]) => ({ cardId, total: totalOf(e), bulk: splitPlayset(totalOf(e), sizeOf(cardId)).bulk, condition: e.condition }))
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

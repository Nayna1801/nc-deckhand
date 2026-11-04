import type { Catalog } from './catalog'
import type { Deck } from './types'

export const MAX_COST_BUCKET = 9

export interface CostBucket {
  cost: number
  label: string
  count: number
}

/** Curva de coste del mazo principal (las Legends no cuentan). El último cubo agrupa 9 o más. */
export function costCurve(deck: Pick<Deck, 'main'>, catalog: Catalog): CostBucket[] {
  const buckets: CostBucket[] = Array.from({ length: MAX_COST_BUCKET + 1 }, (_, cost) => ({
    cost,
    label: cost === MAX_COST_BUCKET ? `${cost}+` : String(cost),
    count: 0,
  }))
  for (const [id, qty] of Object.entries(deck.main)) {
    const c = catalog.byId[id]
    if (!c || c.type === 'Legend' || c.cost == null) continue
    buckets[Math.min(MAX_COST_BUCKET, Math.max(0, c.cost))].count += qty
  }
  return buckets
}

export interface TypeSlice {
  type: 'Unit' | 'Gear' | 'Program'
  count: number
  percent: number
}

export function typeRatio(deck: Pick<Deck, 'main'>, catalog: Catalog): TypeSlice[] {
  const counts = { Unit: 0, Gear: 0, Program: 0 }
  for (const [id, qty] of Object.entries(deck.main)) {
    const t = catalog.byId[id]?.type
    if (t === 'Unit' || t === 'Gear' || t === 'Program') counts[t] += qty
  }
  const total = counts.Unit + counts.Gear + counts.Program
  return (['Unit', 'Gear', 'Program'] as const).map((type) => ({
    type,
    count: counts[type],
    percent: total === 0 ? 0 : Math.round((counts[type] / total) * 1000) / 10,
  }))
}

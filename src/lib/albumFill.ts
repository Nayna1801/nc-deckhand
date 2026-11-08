import type { AlbumSlot } from './album'
import { compareBySetAndNumber } from './catalog'
import { baseOf, copiesOfVariant, type Inventory } from './inventory'
import { printsOf } from './prints'
import type { Card } from './types'

/** Qué cartas de la colección se colocan al rellenar el álbum. */
export type FillKind = 'cards' | 'arts' | 'all'

/**
 * Cartas que tienes, en el orden del catálogo (set y número), listas para colocar en el álbum:
 * - `cards`: el diseño base de cada carta de la que tienes copias normales.
 * - `arts`: tus artes alternativos y promos con diseño propio (una entrada por arte, aunque salga en varios sets).
 * - `all`: las dos cosas, con los artes de cada carta justo después de su diseño base.
 */
export function ownedEntries(inventory: Inventory, kind: FillKind, cards: readonly Card[]): AlbumSlot[] {
  const out: AlbumSlot[] = []
  for (const card of [...cards].sort(compareBySetAndNumber)) {
    const entry = inventory[card.id]
    if (kind !== 'arts' && baseOf(entry) > 0) out.push({ card: card.id })
    if (kind === 'cards') continue
    const seen = new Set<string>()
    for (const p of printsOf(card)) {
      if (p.variantKey === null || seen.has(p.variantKey)) continue
      seen.add(p.variantKey)
      if (copiesOfVariant(entry, p.variantKey) > 0) out.push({ card: card.id, print: p.key })
    }
  }
  return out
}

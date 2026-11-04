import type { Catalog } from './catalog'
import { toCsv } from './csv'
import { neededCards } from './deckRules'
import type { Deck, Quantities } from './types'

export interface WishRow {
  cardId: string
  code: string
  name: string
  set: string
  rarity: string
  needed: number
  owned: number
  missing: number
  decks: string[]
}

/** Cruza los mazos con el inventario real: lo que falta para tener todos montados a la vez. */
export function buildWishlist(decks: Deck[], owned: Quantities, catalog: Catalog): WishRow[] {
  const need = new Map<string, { needed: number; decks: Set<string> }>()
  for (const d of decks) {
    for (const n of neededCards(d, {})) {
      const cur = need.get(n.cardId) ?? { needed: 0, decks: new Set<string>() }
      cur.needed += n.needed
      cur.decks.add(d.name)
      need.set(n.cardId, cur)
    }
  }
  const rows: WishRow[] = []
  for (const [cardId, { needed, decks: names }] of need) {
    const card = catalog.byId[cardId]
    const have = owned[cardId] ?? 0
    if (!card || needed <= have) continue
    rows.push({
      cardId,
      code: card.importId ?? '',
      name: card.displayName,
      set: card.setName,
      rarity: card.rarity ?? '',
      needed,
      owned: have,
      missing: needed - have,
      decks: [...names].sort(),
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export const wishlistToCsv = (rows: WishRow[]): string =>
  toCsv(
    ['code', 'name', 'set', 'rarity', 'needed', 'owned', 'missing', 'decks'],
    rows.map((r) => [r.code, r.name, r.set, r.rarity, r.needed, r.owned, r.missing, r.decks.join(' | ')]),
  )

export interface WantRow {
  cardId: string
  code: string
  name: string
  set: string
  rarity: string
  /** Copias que quieres conseguir. */
  wanted: number
  /** Copias que ya tienes (informativo). */
  owned: number
}

/** Lista de deseos manual: cartas que quieres conseguir, estén o no en un mazo. */
export function buildWants(wants: Quantities, owned: Quantities, catalog: Catalog): WantRow[] {
  const rows: WantRow[] = []
  for (const [cardId, wanted] of Object.entries(wants)) {
    const card = catalog.byId[cardId]
    if (!card || !(wanted > 0)) continue
    rows.push({
      cardId,
      code: card.importId ?? '',
      name: card.displayName,
      set: card.setName,
      rarity: card.rarity ?? '',
      wanted,
      owned: owned[cardId] ?? 0,
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export const wantsToCsv = (rows: WantRow[]): string =>
  toCsv(['code', 'name', 'set', 'rarity', 'wanted', 'owned'], rows.map((r) => [r.code, r.name, r.set, r.rarity, r.wanted, r.owned]))

export const wantsToJson = (rows: WantRow[]): string =>
  JSON.stringify(rows.map(({ cardId, ...rest }) => ({ id: cardId, ...rest })), null, 2)

export function wishlistToJson(rows: WishRow[]): string {
  return JSON.stringify(rows.map(({ cardId, ...rest }) => ({ id: cardId, ...rest })), null, 2)
}

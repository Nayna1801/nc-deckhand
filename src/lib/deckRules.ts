import { copyKey, type Catalog } from './catalog'
import type { Card, Deck, Quantities } from './types'

export const RULES = {
  legends: 3,
  minMain: 40,
  maxMain: 50,
  maxCopies: 3,
  maxSide: 7,
} as const

export const sum = (q: Quantities): number => Object.values(q).reduce((a, b) => a + b, 0)

export interface DeckReport {
  legendCount: number
  mainCount: number
  sideCount: number
  /** Reglas incumplidas: el mazo NO es legal tal como está. */
  errors: string[]
  /** El mazo todavía no está terminado (faltan legends/cartas) pero no rompe ninguna regla. */
  incomplete: string[]
  /** RAM disponible por color según las Legends elegidas. */
  ram: Record<string, number>
  isValid: boolean
}

type DeckLike = Pick<Deck, 'legendIds' | 'main' | 'side'>

export function validateDeck(deck: DeckLike, catalog: Catalog): DeckReport {
  const errors: string[] = []
  const incomplete: string[] = []
  const ram: Record<string, number> = {}

  const legends = deck.legendIds.map((id) => catalog.byId[id]).filter(Boolean)
  const seenNames = new Set<string>()
  for (const l of legends) {
    const key = copyKey(l)
    if (seenNames.has(key)) errors.push(`Las Legends deben ser únicas: ${l.displayName} está repetida.`)
    seenNames.add(key)
    if (l.color && l.ram != null) ram[l.color] = (ram[l.color] ?? 0) + l.ram
  }
  if (legends.length > RULES.legends) errors.push(`Máximo ${RULES.legends} Legends (hay ${legends.length}).`)
  else if (legends.length < RULES.legends) incomplete.push(`Faltan ${RULES.legends - legends.length} Legend(s) para completar el mazo.`)

  const mainCount = sum(deck.main)
  const sideCount = sum(deck.side)
  if (mainCount > RULES.maxMain) errors.push(`El mazo principal admite como máximo ${RULES.maxMain} cartas (hay ${mainCount}).`)
  else if (mainCount < RULES.minMain) incomplete.push(`Faltan ${RULES.minMain - mainCount} carta(s) para llegar al mínimo de ${RULES.minMain}.`)
  if (sideCount > RULES.maxSide) errors.push(`El sideboard admite como máximo ${RULES.maxSide} cartas (hay ${sideCount}).`)

  const totals = new Map<string, { n: number; card: Card }>()
  const walk = (q: Quantities, where: 'principal' | 'sideboard') => {
    for (const [id, n] of Object.entries(q)) {
      const c = catalog.byId[id]
      if (!c) {
        errors.push(`Carta desconocida: ${id}.`)
        continue
      }
      if (c.type === 'Legend') errors.push(`${c.displayName} es una Legend y no puede ir en el ${where}.`)
      const t = totals.get(copyKey(c)) ?? { n: 0, card: c }
      t.n += n
      totals.set(copyKey(c), t)
      if (c.isAlpha) errors.push(`${c.displayName} es una carta Alpha, no legal en Standard.`)
      if (['banned', 'illegal', 'restricted'].includes(c.legality.toLowerCase())) {
        errors.push(`${c.displayName} está ${c.legality} en Standard.`)
      }
      if (c.color && c.ram != null && c.ram > (ram[c.color] ?? 0) && legends.length > 0) {
        errors.push(`${c.displayName} necesita ${c.ram} de RAM ${c.color}, pero tus Legends solo dan ${ram[c.color] ?? 0}.`)
      }
    }
  }
  walk(deck.main, 'principal')
  walk(deck.side, 'sideboard')
  for (const { n, card } of totals.values()) {
    if (n > RULES.maxCopies) errors.push(`${card.displayName}: ${n} copias (máximo ${RULES.maxCopies} entre mazo y sideboard).`)
  }

  return {
    legendCount: legends.length,
    mainCount,
    sideCount,
    errors: [...new Set(errors)],
    incomplete,
    ram,
    isValid: errors.length === 0 && incomplete.length === 0,
  }
}

export interface Needed {
  cardId: string
  needed: number
  owned: number
  missing: number
}

/** Cartas que necesita un mazo (legends + main + side) frente a lo que tienes. */
export function neededCards(deck: DeckLike, owned: Quantities): Needed[] {
  const need: Quantities = {}
  deck.legendIds.forEach((id) => (need[id] = (need[id] ?? 0) + 1))
  for (const q of [deck.main, deck.side]) for (const [id, n] of Object.entries(q)) need[id] = (need[id] ?? 0) + n
  return Object.entries(need).map(([cardId, needed]) => {
    const have = owned[cardId] ?? 0
    return { cardId, needed, owned: have, missing: Math.max(0, needed - have) }
  })
}

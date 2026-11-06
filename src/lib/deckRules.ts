import { copyKey, normalizeText, type Catalog } from './catalog'
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

const NOT_PLAYABLE = ['banned', 'illegal', 'restricted', 'not-legal']

/** Mensaje si la carta no se puede jugar en Standard; null si es legal. */
function legalityError(c: Card): string | null {
  const l = c.legality.toLowerCase()
  if (!NOT_PLAYABLE.includes(l)) return null
  return l === 'not-legal' ? `${c.displayName} no es legal en Standard.` : `${c.displayName} está ${c.legality} en Standard.`
}

export function validateDeck(deck: DeckLike, catalog: Catalog): DeckReport {
  const errors: string[] = []
  const incomplete: string[] = []
  const ram: Record<string, number> = {}

  const legends = deck.legendIds.map((id) => catalog.byId[id]).filter(Boolean)
  // Regla de la web: las Legends son únicas por NOMBRE DE PERSONAJE (lo anterior a ":"), no por versión.
  const seenNames = new Map<string, Card>()
  for (const l of legends) {
    const key = normalizeText(l.name)
    const prev = seenNames.get(key)
    if (prev) errors.push(`Las Legends deben ser únicas: ${prev.displayName} y ${l.displayName} comparten nombre.`)
    seenNames.set(key, l)
    const illegal = legalityError(l)
    if (illegal) errors.push(illegal)
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
      const illegal = legalityError(c)
      if (illegal) errors.push(illegal)
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

/** Suma la RAM que aportan las Legends elegidas, por color. */
export function ramByColor(legendIds: string[], catalog: Catalog): Record<string, number> {
  const ram: Record<string, number> = {}
  for (const id of legendIds) {
    const l = catalog.byId[id]
    if (l?.color && l.ram != null) ram[l.color] = (ram[l.color] ?? 0) + l.ram
  }
  return ram
}

/**
 * ¿La carta pide más RAM de la que dan las Legends? Sin Legends elegidas no se bloquea nada
 * (todavía no hay límite que calcular).
 */
export function exceedsRam(card: Card, legendIds: string[], catalog: Catalog): boolean {
  if (card.type === 'Legend' || !card.color || card.ram == null) return false
  if (legendIds.every((id) => !catalog.byId[id])) return false
  return card.ram > (ramByColor(legendIds, catalog)[card.color] ?? 0)
}

/** Copias de una carta (por nombre, entre mazo y sideboard). */
export function copiesOf(deck: Pick<Deck, 'main' | 'side'>, card: Card, catalog: Catalog): number {
  const key = copyKey(card)
  let n = 0
  for (const q of [deck.main, deck.side]) {
    for (const [id, qty] of Object.entries(q)) if (catalog.byId[id] && copyKey(catalog.byId[id]) === key) n += qty
  }
  return n
}

export const canAddCopy = (deck: Pick<Deck, 'main' | 'side'>, card: Card, catalog: Catalog): boolean =>
  card.type !== 'Legend' && copiesOf(deck, card, catalog) < RULES.maxCopies

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

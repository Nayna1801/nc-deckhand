import type { Card, Quantities } from './types'

/** Orden de los colores en el mazo (el mismo que en los filtros). */
const COLOR_ORDER: Record<string, number> = { Red: 0, Yellow: 1, Blue: 2, Green: 3 }

/** Tipos que se separan en la lista del mazo, en este orden. Las Legends tienen sus propias ranuras. */
const TYPE_GROUPS: { type: string; label: string }[] = [
  { type: 'Unit', label: 'Unidades' },
  { type: 'Gear', label: 'Gear' },
  { type: 'Program', label: 'Programas' },
]

/** Número de coleccionista de la carta («012» → 12, «004a» → 4); 0 si no tiene. */
export const idNumber = (c: Pick<Card, 'importId'>): number => parseInt(c.importId ?? '', 10) || 0

/** Orden dentro de un tipo: por color y, a igual color, por Id (número de coleccionista). */
export function compareByColorAndId(a: Card, b: Card): number {
  return (
    (COLOR_ORDER[a.color ?? ''] ?? 9) - (COLOR_ORDER[b.color ?? ''] ?? 9) ||
    idNumber(a) - idNumber(b) ||
    (a.importId ?? '').localeCompare(b.importId ?? '') ||
    a.displayName.localeCompare(b.displayName)
  )
}

export interface DeckGroup {
  type: string
  label: string
  cards: Card[]
  /** Copias totales del grupo (suma de cantidades). */
  copies: number
}

/** Divide las cartas de una zona del mazo por tipo (Unidades, Gear, Programas), cada grupo ordenado por color e Id. Los grupos vacíos no salen. */
export function groupDeckCards(cards: Card[], quantities: Quantities): DeckGroup[] {
  const known = new Set(TYPE_GROUPS.map((g) => g.type))
  const groups = [...TYPE_GROUPS, { type: '*', label: 'Otras' }].map((g) => ({
    ...g,
    cards: cards.filter((c) => (g.type === '*' ? !known.has(c.type) : c.type === g.type)).sort(compareByColorAndId),
  }))
  return groups.filter((g) => g.cards.length > 0).map((g) => ({ ...g, copies: g.cards.reduce((n, c) => n + (quantities[c.id] ?? 0), 0) }))
}

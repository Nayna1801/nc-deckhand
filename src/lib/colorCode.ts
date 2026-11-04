import type { Catalog } from './catalog'
import type { CardColor } from './types'

export const COLOR_INITIAL: Record<CardColor, string> = { Red: 'R', Yellow: 'Y', Blue: 'B', Green: 'G' }
const CANONICAL: CardColor[] = ['Red', 'Yellow', 'Blue', 'Green']

export interface ColorCode {
  colors: CardColor[]
  /** Iniciales en orden de peso, p. ej. "GGR" (dos Green y un Red). */
  code: string
  /** Nombres completos, p. ej. "GREEN · GREEN · RED". */
  label: string
}

/** Identidad de color de un mazo según sus Legends: el color que más se repite va primero. */
export function colorCode(legendIds: string[], catalog: Catalog): ColorCode {
  const counts = new Map<CardColor, number>()
  for (const id of legendIds) {
    const c = catalog.byId[id]?.color
    if (c && CANONICAL.includes(c)) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  const ordered = [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || CANONICAL.indexOf(a) - CANONICAL.indexOf(b))
  const colors = ordered.flatMap((c) => Array<CardColor>(counts.get(c) ?? 0).fill(c))
  return { colors, code: colors.map((c) => COLOR_INITIAL[c]).join(''), label: colors.map((c) => c.toUpperCase()).join(' · ') }
}

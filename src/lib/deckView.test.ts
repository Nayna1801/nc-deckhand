import { describe, expect, it } from 'vitest'
import { catalog } from './catalog'
import { compareByColorAndId, groupDeckCards, idNumber } from './deckView'
import type { Card } from './types'

const mk = (over: Partial<Card>): Card => ({ ...catalog.cards[0], ...over }) as Card

describe('lista del mazo por tipo, color e Id', () => {
  it('separa Unidades, Gear y Programas, en ese orden, y omite los grupos vacíos', () => {
    const cards = catalog.cards.filter((c) => c.type !== 'Legend').slice(0, 60)
    const q = Object.fromEntries(cards.map((c) => [c.id, 2]))
    const groups = groupDeckCards(cards, q)
    expect(groups.map((g) => g.type)).toEqual(['Unit', 'Gear', 'Program'].filter((t) => cards.some((c) => c.type === t)))
    for (const g of groups) expect(g.cards.every((c) => c.type === g.type)).toBe(true)
    expect(groups.reduce((n, g) => n + g.cards.length, 0)).toBe(cards.length)
    expect(groups.every((g) => g.copies === g.cards.length * 2)).toBe(true)
    expect(groupDeckCards([], {})).toEqual([])
  })

  it('dentro de cada tipo van por color (Red, Yellow, Blue, Green) y después por Id numérico', () => {
    const cards = [
      mk({ id: 'a', color: 'Green', importId: '001', type: 'Unit', displayName: 'A' }),
      mk({ id: 'b', color: 'Red', importId: '020', type: 'Unit', displayName: 'B' }),
      mk({ id: 'c', color: 'Red', importId: '003', type: 'Unit', displayName: 'C' }),
      mk({ id: 'd', color: 'Blue', importId: '100', type: 'Unit', displayName: 'D' }),
      mk({ id: 'e', color: 'Yellow', importId: '050', type: 'Unit', displayName: 'E' }),
      mk({ id: 'f', color: null, importId: '002', type: 'Unit', displayName: 'F' }),
    ]
    const [g] = groupDeckCards(cards, {})
    expect(g.cards.map((c) => c.id)).toEqual(['c', 'b', 'e', 'd', 'a', 'f'])
  })

  it('el Id se compara como número (9 antes que 10) y tolera sufijos y vacíos', () => {
    expect(idNumber({ importId: '004a' })).toBe(4)
    expect(idNumber({ importId: null })).toBe(0)
    const a = mk({ color: 'Red', importId: '9', displayName: 'A' })
    const b = mk({ color: 'Red', importId: '10', displayName: 'B' })
    expect(compareByColorAndId(a, b)).toBeLessThan(0)
  })

  it('un tipo desconocido no desaparece: sale en «Otras»', () => {
    const odd = mk({ id: 'x', type: 'Weird' as Card['type'] })
    const groups = groupDeckCards([odd], { x: 1 })
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Otras')
    expect(groups[0].copies).toBe(1)
  })
})

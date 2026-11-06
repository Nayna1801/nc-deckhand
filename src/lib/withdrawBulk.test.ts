import { describe, expect, it } from 'vitest'
import { totalOf, withdrawBulk, type Inventory } from './inventory'

const e = (normal: number, foil = 0, promo = 0) => ({ normal, foil, promo, arts: {}, condition: 'mint' as const })

describe('withdrawBulk', () => {
  it('descuenta las copias retiradas y respeta el playset', () => {
    const inv: Inventory = { a: e(5) } // playset 3 + bulk 2
    const { next, changed } = withdrawBulk(inv, [{ cardId: 'a', qty: 2 }])
    expect(next.a.normal).toBe(3)
    expect(changed).toEqual(['a'])
  })

  it('nunca baja del playset aunque se pida más que el bulk', () => {
    const { next } = withdrawBulk({ a: e(5) }, [{ cardId: 'a', qty: 99 }])
    expect(totalOf(next.a)).toBe(3)
  })

  it('una Legend tiene playset 1: retira hasta dejar una', () => {
    const { next } = withdrawBulk({ l: e(3) }, [{ cardId: 'l', qty: 99 }], () => 1)
    expect(totalOf(next.l)).toBe(1)
  })

  it('quita primero las Normales, luego Promo y al final Foil', () => {
    const { next } = withdrawBulk({ a: e(1, 2, 2) }, [{ cardId: 'a', qty: 2 }]) // total 5 -> bulk 2
    expect(next.a).toMatchObject({ normal: 0, promo: 1, foil: 2 })
  })

  it('sin bulk no cambia nada ni marca la carta como modificada', () => {
    const inv: Inventory = { a: e(3), b: e(2) }
    const { next, changed } = withdrawBulk(inv, [{ cardId: 'a', qty: 1 }, { cardId: 'b', qty: 1 }])
    expect(changed).toEqual([])
    expect(next).toEqual(inv)
  })

  it('procesa varias cartas a la vez, ignora desconocidas y valores raros, y no muta el original', () => {
    const inv: Inventory = { a: e(4), b: e(6), c: e(3) }
    const copy = JSON.parse(JSON.stringify(inv))
    const { next, changed } = withdrawBulk(inv, [
      { cardId: 'a', qty: 1 },
      { cardId: 'b', qty: 3 },
      { cardId: 'zzz', qty: 5 },
      { cardId: 'c', qty: Number.NaN },
      { cardId: 'c', qty: -4 },
    ])
    expect(changed.sort()).toEqual(['a', 'b'])
    expect(totalOf(next.a)).toBe(3)
    expect(totalOf(next.b)).toBe(3)
    expect(next.c).toEqual(inv.c)
    expect(inv).toEqual(copy)
  })

  it('suma peticiones repetidas de la misma carta', () => {
    const { next } = withdrawBulk({ a: e(8) }, [{ cardId: 'a', qty: 2 }, { cardId: 'a', qty: 2 }])
    expect(totalOf(next.a)).toBe(4)
  })

  it('conserva el estado (condition) de la carta', () => {
    const { next } = withdrawBulk({ a: { ...e(5), condition: 'played' as const } }, [{ cardId: 'a', qty: 1 }])
    expect(next.a.condition).toBe('played')
  })
})

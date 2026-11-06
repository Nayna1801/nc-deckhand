import { describe, expect, it } from 'vitest'
import { clampPick, ownedKinds, pickedOf, pickedTotal, totalOf, withdrawBulk, withPicked, type Inventory } from './inventory'

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

describe('withdrawBulk eligiendo qué copias', () => {
  const inv = (): Inventory => ({ c: { normal: 2, foil: 1, promo: 1, arts: { 'alt:a': 1, 'alt:b': 2 }, condition: 'mint' } }) // total 7, bulk 4

  it('quita exactamente las copias elegidas (un arte concreto, no el orden habitual)', () => {
    const { next, changed } = withdrawBulk(inv(), [{ cardId: 'c', pick: { arts: { 'alt:b': 2 } } }])
    expect(changed).toEqual(['c'])
    expect(next.c.arts).toEqual({ 'alt:a': 1 })
    expect(next.c.normal).toBe(2)
    expect(next.c.foil).toBe(1)
  })

  it('puede mezclar tipos: base, foil y artes a la vez', () => {
    const { next } = withdrawBulk(inv(), [{ cardId: 'c', pick: { normal: 1, foil: 1, arts: { 'alt:a': 1 } } }])
    expect(next.c).toMatchObject({ normal: 1, foil: 0, promo: 1, arts: { 'alt:b': 2 } })
  })

  it('no retira más de lo que hay de cada tipo ni más de lo que sobra del playset', () => {
    const r = withdrawBulk(inv(), [{ cardId: 'c', pick: { normal: 99, arts: { 'alt:b': 99 } } }])
    expect(totalOf(r.next.c)).toBe(3) // playset de 3 intacto
    const r2 = withdrawBulk(inv(), [{ cardId: 'c', pick: { arts: { 'alt:zzz': 5 } } }])
    expect(r2.changed).toEqual([])
  })

  it('las copias elegidas cuentan primero y el resto del bulk se quita en el orden habitual', () => {
    const { next } = withdrawBulk(inv(), [{ cardId: 'c', pick: { arts: { 'alt:b': 1 } }, qty: 2 }]) // bulk 4: 1 elegida + 2 por orden
    expect(next.c.arts).toEqual({ 'alt:a': 1, 'alt:b': 1 })
    expect(next.c.normal).toBe(0) // las 2 por orden salen de las Normales
    expect(totalOf(next.c)).toBe(4)
  })

  it('una selección vacía o con ceros no cambia nada', () => {
    const r = withdrawBulk(inv(), [{ cardId: 'c', pick: { normal: 0, arts: {} } }, { cardId: 'c', pick: undefined }])
    expect(r.changed).toEqual([])
  })

  it('valores raros (negativos, NaN, decimales) se ignoran o se redondean', () => {
    const r = withdrawBulk(inv(), [{ cardId: 'c', pick: { normal: -3, foil: Number.NaN, promo: 1.9 } }])
    expect(r.next.c.promo).toBe(0)
    expect(r.next.c.normal).toBe(2)
    expect(r.next.c.foil).toBe(1)
  })

  it('no muta el inventario original', () => {
    const original = inv()
    const copy = JSON.parse(JSON.stringify(original))
    withdrawBulk(original, [{ cardId: 'c', pick: { arts: { 'alt:b': 2 }, normal: 1 } }])
    expect(original).toEqual(copy)
  })

  it('ownedKinds lista solo lo que tienes, base primero y artes por orden', () => {
    expect(ownedKinds(inv().c).map((k) => `${k.id}:${k.owned}`)).toEqual(['normal:2', 'promo:1', 'foil:1', 'alt:a:1', 'alt:b:2'])
    expect(ownedKinds(undefined)).toEqual([])
    expect(ownedKinds({ normal: 0, foil: 0, promo: 0, arts: {}, condition: 'mint' })).toEqual([])
  })

  it('pickedTotal suma todos los tipos', () => {
    expect(pickedTotal({ normal: 1, foil: 2, promo: 3, arts: { a: 4, b: 5 } })).toBe(15)
    expect(pickedTotal(undefined)).toBe(0)
  })
})

describe('selección de copias a retirar', () => {
  const e = { normal: 2, foil: 1, promo: 0, arts: { 'alt:a': 1, 'alt:b': 2 }, condition: 'mint' as const }

  it('withPicked / pickedOf funcionan para base y para artes sin tocar lo demás', () => {
    let p = withPicked(undefined, 'normal', 1)
    p = withPicked(p, 'alt:b', 2)
    p = withPicked(p, 'foil', 1)
    expect(pickedOf(p, 'normal')).toBe(1)
    expect(pickedOf(p, 'alt:b')).toBe(2)
    expect(pickedOf(p, 'alt:a')).toBe(0)
    expect(pickedOf(p, 'promo')).toBe(0)
    expect(pickedTotal(p)).toBe(4)
  })

  it('withPicked no muta la selección anterior y sanea valores raros', () => {
    const base = withPicked(undefined, 'alt:a', 1)
    const copy = JSON.parse(JSON.stringify(base))
    withPicked(base, 'alt:a', 5)
    expect(base).toEqual(copy)
    expect(pickedOf(withPicked(undefined, 'normal', -2), 'normal')).toBe(0)
    expect(pickedOf(withPicked(undefined, 'normal', Number.NaN), 'normal')).toBe(0)
  })

  it('clampPick limita cada clase a lo que tienes y el total a lo que sobra', () => {
    const c = clampPick({ normal: 9, foil: 9, arts: { 'alt:a': 9, 'alt:b': 9, 'alt:zzz': 4 } }, e, 3)
    expect(pickedTotal(c)).toBe(3)
    expect(c.normal).toBe(2)
    expect(c.foil).toBe(1)
    expect(c.arts).toBeUndefined()
  })

  it('clampPick con bulk 0, sin entrada o sin selección da una selección vacía', () => {
    expect(clampPick({ normal: 2 }, e, 0)).toEqual({})
    expect(clampPick({ normal: 2 }, undefined, 5)).toEqual({})
    expect(clampPick(undefined, e, 5)).toEqual({})
  })

  it('una selección ajustada es siempre aceptada por withdrawBulk sin recortes sorpresa', () => {
    const inv: Inventory = { c: e } // total 6, bulk 3
    const pick = clampPick({ normal: 1, foil: 1, arts: { 'alt:b': 5 } }, e, 3)
    const { next } = withdrawBulk(inv, [{ cardId: 'c', pick }])
    expect(totalOf(next.c)).toBe(totalOf(e) - pickedTotal(pick))
  })
})

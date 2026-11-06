import { describe, expect, it } from 'vitest'
import { catalog } from './catalog'
import { adjustCopies, baseOf, copiesOfVariant, sanitizeArts, sanitizeEntry, totalOf, withdrawBulk, type InventoryEntry } from './inventory'
import { buildPrints } from './prints'
import { TOTAL_VARIANTS, variantsOf } from './variants'

const entry = (p: Partial<InventoryEntry>): InventoryEntry => sanitizeEntry(p)

describe('copias por arte alternativo', () => {
  it('las copias de arte cuentan en el total pero no en las del diseño base', () => {
    const e = entry({ normal: 2, arts: { 'alt:a': 1, 'alt:b': 2 } })
    expect(totalOf(e)).toBe(5)
    expect(baseOf(e)).toBe(2)
    expect(copiesOfVariant(e, null)).toBe(2)
    expect(copiesOfVariant(e, 'alt:b')).toBe(2)
    expect(copiesOfVariant(e, 'alt:zzz')).toBe(0)
  })

  it('sanitizeArts descarta claves y cantidades inválidas', () => {
    expect(sanitizeArts(null)).toEqual({})
    expect(sanitizeArts([1, 2])).toEqual({})
    expect(sanitizeArts('x')).toEqual({})
    expect(sanitizeArts({ 'alt:ok': 2, 'alt:cero': 0, 'alt:neg': -3, 'alt:nan': 'x', 'mala clave!': 1, '': 1, ['x'.repeat(81)]: 1 })).toEqual({ 'alt:ok': 2 })
    expect(sanitizeArts({ 'alt:grande': 99999 })).toEqual({ 'alt:grande': 999 })
    expect(sanitizeArts({ 'print:x#β141': 1 })).toEqual({ 'print:x#β141': 1 })
  })

  it('limita el número de artes por carta', () => {
    const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`alt:k${i}`, 1]))
    expect(Object.keys(sanitizeArts(many)).length).toBeLessThanOrEqual(60)
  })

  it('no admite claves que ensucien el objeto (__proto__)', () => {
    const r = sanitizeArts(JSON.parse('{"__proto__": 5, "alt:a": 1}'))
    expect(Object.keys(r)).toEqual(['alt:a'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('al restar del total, los artes alternativos se conservan hasta el final', () => {
    const e = entry({ normal: 1, promo: 1, foil: 1, arts: { 'alt:b': 1, 'alt:a': 2 } })
    const a = adjustCopies(e, -3) // normal, promo, foil
    expect(baseOf(a)).toBe(0)
    expect(a.arts).toEqual({ 'alt:a': 2, 'alt:b': 1 })
    const b = adjustCopies(e, -4) // y una del primer arte por orden alfabético
    expect(b.arts).toEqual({ 'alt:a': 1, 'alt:b': 1 })
    const all = adjustCopies(e, -99)
    expect(totalOf(all)).toBe(0)
    expect(all.arts).toEqual({})
  })

  it('sumar al total añade una Normal y no toca los artes', () => {
    const e = entry({ normal: 1, arts: { 'alt:a': 1 } })
    const r = adjustCopies(e, 2)
    expect(r.normal).toBe(3)
    expect(r.arts).toEqual({ 'alt:a': 1 })
  })

  it('no muta la entrada original al restar', () => {
    const e = entry({ normal: 0, arts: { 'alt:a': 2 } })
    adjustCopies(e, -1)
    expect(e.arts).toEqual({ 'alt:a': 2 })
  })

  it('retirar bulk quita primero las copias base y deja los artes para el final', () => {
    const inv = { c: entry({ normal: 3, arts: { 'alt:a': 1 } }) } // total 4, bulk 1
    const { next } = withdrawBulk(inv, [{ cardId: 'c', qty: 1 }])
    expect(next.c.normal).toBe(2)
    expect(next.c.arts).toEqual({ 'alt:a': 1 })
  })
})

describe('artes del catálogo', () => {
  it('cada arte alternativo es una variante con clave única', () => {
    let alts = 0
    for (const c of catalog.cards) {
      const v = variantsOf(c)
      expect(new Set(v.map((x) => x.key)).size, c.id).toBe(v.length)
      alts += c.altArts.length
      for (const a of c.altArts) expect(v.some((x) => x.key === `alt:${a.id}`), `${c.id} ${a.id}`).toBe(true)
    }
    expect(alts).toBe(102)
    expect(TOTAL_VARIANTS).toBeGreaterThanOrEqual(102)
  })

  it('las claves de las variantes son válidas para guardarse', () => {
    for (const c of catalog.cards) for (const v of variantsOf(c)) expect(sanitizeArts({ [v.key]: 1 }), `${c.id} ${v.key}`).toEqual({ [v.key]: 1 })
  })

  it('toda impresión con arte propio apunta a una variante de su carta y las base no', () => {
    for (const e of buildPrints(catalog.cards)) {
      const keys = variantsOf(e.card).map((v) => v.key)
      if (e.variantKey === null) {
        expect(e.art === 'exact' || e.art === 'original', e.key).toBe(true)
      } else {
        expect(keys, e.key).toContain(e.variantKey)
      }
    }
  })

  it('Beta y Retail del mismo arte alternativo son diseños distintos; las cartas base de ambas cuentan juntas', () => {
    const adam = catalog.byId['adam_smasher_ender_of_legends']
    const prints = buildPrints([adam])
    const beta = prints.find((p) => p.setName === 'Welcome to Night City — Beta')
    const retailAlt = prints.find((p) => p.setName === 'Welcome to Night City — Retail' && p.collectorNumber === '141')
    const retailBase = prints.find((p) => p.isOriginal)
    expect(beta?.variantKey).not.toBeNull()
    expect(retailAlt?.variantKey).not.toBeNull()
    expect(beta?.variantKey).not.toBe(retailAlt?.variantKey)
    expect(retailBase?.variantKey).toBeNull()
  })
})

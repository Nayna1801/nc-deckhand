import { describe, expect, it } from 'vitest'
import { catalog } from './catalog'
import { buildPrints, compareBySet, expandPrints, NO_SET, printsOf } from './prints'

const card = (id: string) => catalog.byId[id]

describe('impresiones', () => {
  const all = buildPrints(catalog.cards)

  it('cada carta tiene al menos una impresión y exactamente una es la original', () => {
    for (const c of catalog.cards) {
      const p = printsOf(c)
      expect(p.length, c.id).toBeGreaterThan(0)
      expect(p.filter((x) => x.isOriginal).length, c.id).toBe(1)
    }
  })

  it('las claves son únicas y todas las imágenes existen en el catálogo', () => {
    expect(new Set(all.map((e) => e.key)).size).toBe(all.length)
    expect(all.length).toBeGreaterThan(catalog.cards.length)
    expect(all.every((e) => e.image.startsWith('cards/'))).toBe(true)
  })

  it('no se cuentan las versiones en francés como impresiones aparte', () => {
    for (const c of catalog.cards) {
      const en = c.printings.filter((p) => p.language === 'en')
      const keys = new Set(en.map((p) => `${p.baseSetName}#${p.collectorNumber}`))
      expect(printsOf(c).filter((e) => e.setName !== NO_SET).length, c.id).toBe(keys.size)
    }
  })

  it('un arte alternativo con imagen y el mismo set y número se usa como imagen exacta de esa impresión', () => {
    const adam = printsOf(card('adam_smasher_ender_of_legends'))
    const promo = adam.find((e) => e.setName === 'Set 1 Promos')
    expect(promo?.art).toBe('exact')
    expect(promo?.image).toBe('cards/alt/adam_smasher_ender_of_legends__prm01_008.webp')
    expect(promo?.altIndex).toBeGreaterThanOrEqual(0)
    const original = adam.find((e) => e.isOriginal)
    expect(original?.image).toBe(card('adam_smasher_ender_of_legends').image)
  })

  it('una reimpresión con el mismo ilustrador reutiliza la imagen original', () => {
    const goro = printsOf(card('goro_takemura_hands_unclean')).find((e) => e.setName === 'Arasaka Demo Deck')
    expect(goro?.art).toBe('original')
    expect(goro?.image).toBe(card('goro_takemura_hands_unclean').image)
  })

  it('nunca se marca como exacta una imagen que no es de esa impresión', () => {
    for (const e of all) {
      if (e.art === 'exact' && !e.isOriginal) {
        expect(e.card.altArts[e.altIndex]?.image, e.key).toBe(e.image)
      }
    }
  })

  it('expandPrints con un set elegido deja solo las impresiones de ese set', () => {
    const promos = expandPrints(catalog.cards, { sets: ['Set 1 Promos'], bySet: true })
    expect(promos.length).toBeGreaterThan(0)
    expect(promos.every((e) => e.setName === 'Set 1 Promos')).toBe(true)
    const n = catalog.cards.reduce((a, c) => a + printsOf(c).filter((e) => e.setName === 'Set 1 Promos').length, 0)
    expect(promos).toHaveLength(n)
  })

  it('varios sets suman sus impresiones', () => {
    const a = expandPrints(catalog.cards, { sets: ['Set 1 Promos'], bySet: true })
    const b = expandPrints(catalog.cards, { sets: ['Judge Promos'], bySet: true })
    const both = expandPrints(catalog.cards, { sets: ['Set 1 Promos', 'Judge Promos'], bySet: true })
    expect(both).toHaveLength(a.length + b.length)
  })

  it('con orden por set los grupos quedan contiguos y por número', () => {
    const list = expandPrints(catalog.cards, { bySet: true })
    const seen = new Set<string>()
    let prev = ''
    for (const e of list) {
      if (e.setName !== prev) {
        expect(seen.has(e.setName), `set repetido: ${e.setName}`).toBe(false)
        seen.add(e.setName)
        prev = e.setName
      }
    }
    const sorted = [...list].sort(compareBySet)
    expect(sorted.map((e) => e.key)).toEqual(list.map((e) => e.key))
  })

  it('sin orden por set se respeta el orden de las cartas', () => {
    const cards = [card('minotaur'), card('adam_smasher_ender_of_legends')]
    const list = expandPrints(cards, { bySet: false })
    const ids = [...new Set(list.map((e) => e.card.id))]
    expect(ids).toEqual(['minotaur', 'adam_smasher_ender_of_legends'])
  })
})

describe('artes alternativos sin set', () => {
  it('cada arte alternativo del catálogo tiene su ficha, también los que no pertenecen a ningún set', () => {
    for (const c of catalog.cards) {
      const keys = new Set(printsOf(c).map((e) => e.variantKey))
      for (const a of c.altArts) expect(keys.has(`alt:${a.id}`), `${c.id} ${a.id}`).toBe(true)
    }
    const sinSet = buildPrints(catalog.cards).filter((e) => e.setName === NO_SET)
    expect(sinSet).toHaveLength(9)
    expect(sinSet.every((e) => e.art === 'exact' && e.variantKey !== null)).toBe(true)
  })
})

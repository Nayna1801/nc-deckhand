import { describe, expect, it } from 'vitest'
import { catalog, compareBySetAndNumber, setLabel } from './catalog'
import { keywordsOf } from './search'

describe('orden por set y número', () => {
  const sorted = [...catalog.cards].sort(compareBySetAndNumber)

  it('agrupa por set: cada set aparece en un único bloque contiguo', () => {
    const seen = new Set<string>()
    let prev = ''
    for (const c of sorted) {
      if (c.setCode !== prev) {
        expect(seen.has(c.setCode), `el set ${c.setCode} aparece partido`).toBe(false)
        seen.add(c.setCode)
        prev = c.setCode
      }
    }
    expect(seen.size).toBe(new Set(catalog.cards.map((c) => c.setCode)).size)
  })

  it('dentro de cada set ordena por número de coleccionista', () => {
    for (const code of new Set(sorted.map((c) => c.setCode))) {
      const nums = sorted.filter((c) => c.setCode === code).map((c) => parseInt(c.importId ?? '0', 10))
      expect(nums).toEqual([...nums].sort((a, b) => a - b))
    }
  })

  it('el set principal va primero y no se mezclan Yorinobu (nº 1) y Viktor (nº 1) de sets distintos', () => {
    expect(sorted[0].setCode).toBe('welcometonightcityretail')
    const yor = sorted.findIndex((c) => c.id === 'yorinobu_arasaka_embracing_destruction')
    const vik = sorted.findIndex((c) => c.id === 'viktor_vektor_sit_down_and_relax')
    expect(yor).not.toBe(vik)
    expect(Math.abs(yor - vik)).toBeGreaterThan(1)
    expect(catalog.byId.yorinobu_arasaka_embracing_destruction.setCode).not.toBe(catalog.byId.viktor_vektor_sit_down_and_relax.setCode)
  })

  it('cada set tiene un nombre legible para el encabezado', () => {
    for (const c of catalog.cards) expect(setLabel(c).length).toBeGreaterThan(3)
  })
})

describe('keywords y disparadores para los filtros', () => {
  it('detecta las keywords del texto de reglas', () => {
    const blockers = catalog.cards.filter((c) => keywordsOf(c).has('blocker'))
    expect(blockers.length).toBeGreaterThan(0)
    expect(blockers.every((c) => /\{blocker\}/i.test(c.rules))).toBe(true)
    expect(catalog.cards.some((c) => keywordsOf(c).has('gosolo'))).toBe(true)
    expect(catalog.cards.some((c) => keywordsOf(c).has('spend'))).toBe(true)
  })
})

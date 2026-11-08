import { existsSync } from 'node:fs'
import { join } from 'node:path'
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

describe('impresiones promocionales', () => {
  it('las Judge Promos tienen su imagen propia (con la marca Judge) y se cuentan aparte', () => {
    const judge = expandPrints(catalog.cards, { sets: ['Judge Promos'], bySet: true })
    expect(judge).toHaveLength(3)
    for (const e of judge) {
      expect(e.art, e.key).toBe('exact')
      expect(e.image, e.key).toMatch(/^cards\/alt\/.+__judgepromos_/)
      expect(e.image).not.toBe(e.card.image)
      expect(e.variantKey).toBe(`alt:${e.setCode.toLowerCase()}_${e.collectorNumber}`)
    }
  })

  it('una impresión promocional sin imagen propia se marca como aproximada y se cuenta aparte', () => {
    const card = { ...catalog.byId['secondhand_bombus'], altArts: [] }
    const judge = printsOf(card).find((e) => e.setName === 'Judge Promos')
    expect(judge?.art).toBe('marked')
    expect(judge?.image).toBe(card.image)
    expect(judge?.variantKey).toBe(`print:judgepromos#${judge?.collectorNumber}`)
  })

  it('una reimpresión normal con el mismo ilustrador sigue siendo el diseño base', () => {
    const goro = printsOf(catalog.byId['goro_takemura_hands_unclean']).find((e) => e.setName === 'Arasaka Demo Deck')
    expect(goro?.art).toBe('original')
    expect(goro?.variantKey).toBeNull()
  })
})

describe('catálogo completo de impresiones', () => {
  it('las cartas de Set 1 Promos que no tienen versión base ya están (Rebecca y Lucyna)', () => {
    const rebecca = catalog.byId['rebecca_having_a_moment']
    const lucyna = catalog.byId['lucyna_kushinada_fresh_beginnings']
    expect(rebecca?.setName).toBe('Set 1 Promos')
    expect(lucyna?.setName).toBe('Set 1 Promos')
    const promoCards = new Set(expandPrints(catalog.cards, { sets: ['Set 1 Promos'], bySet: true }).map((e) => e.card.id))
    expect(promoCards.has('rebecca_having_a_moment')).toBe(true)
    expect(promoCards.has('lucyna_kushinada_fresh_beginnings')).toBe(true)
    expect(existsSync(join(process.cwd(), 'public', rebecca.image))).toBe(true)
  })

  it('están los sets Beta de los mazos de inicio y de las promos de caja', () => {
    const sets = new Set(buildPrints(catalog.cards).map((e) => e.setName))
    for (const s of ['Embracing Power — Beta Starter Deck', 'The Heist — Beta Starter Deck', 'Box Toppers — Beta', 'Pre-Release Beta', 'Welcome to Night City — Beta']) {
      expect(sets.has(s), s).toBe(true)
    }
  })

  it('con los datos actuales ninguna impresión se queda sin su imagen: o la tiene propia, o es el mismo arte que la base, o es un Pre-Release con marca', () => {
    for (const e of buildPrints(catalog.cards)) {
      if (e.art === 'marked') expect(e.setName, e.key).toMatch(/pre-?release/i)
      else expect(['exact', 'original'], `${e.key} (${e.art})`).toContain(e.art)
    }
  })

  it('los Pre-Release se cuentan como diseño propio (promo con marca) y la versión Beta y la Retail cuentan juntas', () => {
    const pre = buildPrints(catalog.cards).filter((e) => /^Pre-Release/.test(e.setName))
    expect(pre.length).toBeGreaterThan(0)
    for (const e of pre) {
      expect(e.art, e.key).toBe('marked')
      expect(e.variantKey, e.key).toBe('print:prerelease')
    }
    const royce = printsOf(catalog.byId['royce_psycho_on_the_edge']).filter((e) => /^Pre-Release/.test(e.setName))
    expect(royce.map((e) => e.setName).sort()).toEqual(['Pre-Release Beta', 'Pre-Release Retail'])
    expect(new Set(royce.map((e) => e.variantKey)).size).toBe(1)
  })

  it('los Pre-Release salen al listar ese set y al ver solo artes alternativos y promos', () => {
    const listed = expandPrints(catalog.cards, { sets: ['Pre-Release Retail'], bySet: true })
    expect(listed.length).toBeGreaterThan(0)
    expect(listed.every((e) => e.variantKey !== null)).toBe(true)
  })

  it('cada arte alternativo con imagen se corresponde con su impresión (mismo set y número)', () => {
    for (const c of catalog.cards) {
      for (const a of c.altArts) {
        if (!a.setCode || !a.image) continue
        const hit = printsOf(c).find((e) => e.setCode.toLowerCase() === a.setCode?.toLowerCase() && e.collectorNumber === a.collectorNumber)
        expect(hit?.image, `${c.id} ${a.id}`).toBe(a.image)
      }
    }
  })
})

describe('imágenes aproximadas (cuando falta la de una impresión)', () => {
  const base = catalog.byId['goro_takemura_hands_unclean']
  const withPrint = (p: Partial<(typeof base.printings)[number]>) => ({
    ...base,
    altArts: [],
    printings: [...base.printings.filter((x) => x.isPrimary), { ...base.printings[0], isPrimary: false, language: 'en' as const, setCode: 'zz', setName: 'Zeta', baseSetName: 'Zeta', collectorNumber: '9', ...p }],
  })

  it('otro ilustrador y sin imagen: se muestra la original y se marca como desconocida, contable aparte', () => {
    const e = printsOf(withPrint({ artist: 'Alguien Distinto' })).find((x) => x.setName === 'Zeta')
    expect(e?.art).toBe('unknown')
    expect(e?.image).toBe(base.image)
    expect(e?.variantKey).toBe('print:zz#9')
  })

  it('mismo ilustrador en un set normal: es el diseño base', () => {
    const e = printsOf(withPrint({ artist: base.artist })).find((x) => x.setName === 'Zeta')
    expect(e?.art).toBe('original')
    expect(e?.variantKey).toBeNull()
  })

  it('otro ilustrador que coincide con un arte alternativo de la carta: arte probable', () => {
    const card = { ...withPrint({ artist: 'Pandart Studio' }), altArts: [{ id: 'x', image: 'cards/alt/x.webp', label: null, collectorNumber: '1', artist: 'Pandart Studio', rarity: null, finish: null, setCode: 'otro', setName: 'Otro', baseSetName: 'Otro', edition: null }] }
    const e = printsOf(card).find((x) => x.setName === 'Zeta')
    expect(e?.art).toBe('likely')
    expect(e?.image).toBe('cards/alt/x.webp')
  })
})

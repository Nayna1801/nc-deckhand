import { describe, expect, it } from 'vitest'
import { catalog } from './catalog'
import { ownedEntries } from './albumFill'
import { sanitizeEntry, type Inventory } from './inventory'
import { printsOf } from './prints'

const inv = (o: Record<string, Partial<Parameters<typeof sanitizeEntry>[0]>>): Inventory => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sanitizeEntry(v)]))

describe('rellenar el álbum con la colección', () => {
  const adam = catalog.byId['adam_smasher_ender_of_legends']
  const adamArts = printsOf(adam).filter((p) => p.variantKey !== null)

  it('sin colección no hay nada que colocar', () => {
    for (const k of ['cards', 'arts', 'all'] as const) expect(ownedEntries({}, k, catalog.cards)).toEqual([])
  })

  it('«cards» pone el diseño base de las cartas con copias, en el orden del catálogo', () => {
    const list = ownedEntries(inv({ saul_bright_stormrider: { normal: 1 }, adam_smasher_ender_of_legends: { foil: 2 } }), 'cards', catalog.cards)
    expect(list.map((e) => e.card)).toEqual(['adam_smasher_ender_of_legends', 'saul_bright_stormrider'])
    expect(list.every((e) => e.print === undefined)).toBe(true)
  })

  it('«arts» solo pone los artes que tienes, uno por arte, con su impresión', () => {
    const key = adamArts[0].variantKey as string
    const list = ownedEntries(inv({ adam_smasher_ender_of_legends: { normal: 3, arts: { [key]: 2 } } }), 'arts', catalog.cards)
    expect(list).toHaveLength(1)
    expect(list[0].card).toBe(adam.id)
    expect(printsOf(adam).find((p) => p.key === list[0].print)?.variantKey).toBe(key)
  })

  it('«all» pone cada arte justo después del diseño base de su carta', () => {
    const key = adamArts[0].variantKey as string
    const list = ownedEntries(inv({ adam_smasher_ender_of_legends: { normal: 1, arts: { [key]: 1 } }, saul_bright_stormrider: { normal: 1 } }), 'all', catalog.cards)
    expect(list.map((e) => `${e.card}${e.print ? '+arte' : ''}`)).toEqual(['adam_smasher_ender_of_legends', 'adam_smasher_ender_of_legends+arte', 'saul_bright_stormrider'])
  })

  it('un arte de una carta de la que no tienes la base también aparece, y un arte con 0 copias no', () => {
    const [a, b] = adamArts
    const list = ownedEntries(inv({ adam_smasher_ender_of_legends: { arts: { [a.variantKey as string]: 1, [b.variantKey as string]: 0 } } }), 'all', catalog.cards)
    expect(list).toHaveLength(1)
    expect(list[0].print).toBeDefined()
  })

  it('los Pre-Release en Beta y Retail (mismo arte propio) salen una sola vez', () => {
    const royce = catalog.byId['royce_psycho_on_the_edge']
    const list = ownedEntries(inv({ royce_psycho_on_the_edge: { arts: { 'print:prerelease': 1 } } }), 'arts', [royce])
    expect(list).toHaveLength(1)
  })
})

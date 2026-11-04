import { describe, expect, it } from 'vitest'
import { catalog } from './catalog'
import { costCurve, typeRatio } from './analytics'
import { canAddCopy, copiesOf, exceedsRam, ramByColor } from './deckRules'
import { bulkList, sanitizeEntry, splitPlayset, totalOf, totalsByCard } from './inventory'
import { decodeDeck, encodeDeck } from './shareCode'
import { buildWishlist, wishlistToCsv, wishlistToJson } from './wishlist'
import { parseDeckText } from './deckText'
import fixtures from './__fixtures__/siteDecks.json'
import type { Deck } from './types'

const realDeck = (i: number): Deck => {
  const p = parseDeckText(fixtures[i].text, catalog)
  return { id: `d${i}`, name: p.name, legendIds: p.legendIds, main: p.main, side: p.side, updatedAt: '' }
}

describe('analítica del mazo', () => {
  it('la curva de coste suma exactamente las cartas del mazo principal', () => {
    const d = realDeck(3)
    const total = costCurve(d, catalog).reduce((a, b) => a + b.count, 0)
    expect(total).toBe(Object.values(d.main).reduce((a, b) => a + b, 0))
  })

  it('agrupa 9 o más en el último cubo y respeta la cantidad', () => {
    const nine = catalog.cards.find((c) => c.type !== 'Legend' && c.cost === 9)!
    const curve = costCurve({ main: { [nine.id]: 2 } }, catalog)
    expect(curve[9]).toMatchObject({ label: '9+', count: 2 })
  })

  it('el ratio de tipos suma 100 y no cuenta Legends', () => {
    const r = typeRatio(realDeck(0), catalog)
    expect(r.reduce((a, b) => a + b.count, 0)).toBe(40)
    expect(Math.round(r.reduce((a, b) => a + b.percent, 0))).toBe(100)
  })

  it('devuelve 0% sin romper cuando el mazo está vacío', () => {
    expect(typeRatio({ main: {} }, catalog).every((s) => s.percent === 0)).toBe(true)
  })
})

describe('RAM y tope de copias', () => {
  const goro = 'goro_takemura_hands_unclean'
  it('suma la RAM por color de las Legends', () => {
    expect(ramByColor([goro], catalog)).toEqual({ Green: 2 })
  })

  it('no bloquea nada si todavía no hay Legends', () => {
    const c = catalog.cards.find((x) => x.type !== 'Legend' && (x.ram ?? 0) >= 4)!
    expect(exceedsRam(c, [], catalog)).toBe(false)
  })

  it('bloquea las cartas que superan la RAM de su color', () => {
    const c = catalog.cards.find((x) => x.type !== 'Legend' && x.color === 'Green' && (x.ram ?? 0) > 2)!
    expect(exceedsRam(c, [goro], catalog)).toBe(true)
    const ok = catalog.cards.find((x) => x.type !== 'Legend' && x.color === 'Green' && (x.ram ?? 0) <= 2)!
    expect(exceedsRam(ok, [goro], catalog)).toBe(false)
  })

  it('desactiva "añadir" al llegar a 3 copias entre mazo y sideboard', () => {
    const c = catalog.byId.saul_bright_stormrider
    expect(canAddCopy({ main: { [c.id]: 2 }, side: {} }, c, catalog)).toBe(true)
    expect(canAddCopy({ main: { [c.id]: 2 }, side: { [c.id]: 1 } }, c, catalog)).toBe(false)
    expect(copiesOf({ main: { [c.id]: 2 }, side: { [c.id]: 1 } }, c, catalog)).toBe(3)
  })

  it('las Legends nunca se pueden añadir como copias', () => {
    expect(canAddCopy({ main: {}, side: {} }, catalog.byId[goro], catalog)).toBe(false)
  })
})

describe('inventario y bulk', () => {
  it('playset: hasta 3 activas, la 4ª en adelante va a bulk', () => {
    expect(splitPlayset(0)).toEqual({ active: 0, bulk: 0 })
    expect(splitPlayset(3)).toEqual({ active: 3, bulk: 0 })
    expect(splitPlayset(4)).toEqual({ active: 3, bulk: 1 })
    expect(splitPlayset(7)).toEqual({ active: 3, bulk: 4 })
  })

  it('suma versiones Normal + Foil + Promo', () => {
    expect(totalOf({ normal: 2, foil: 1, promo: 1 })).toBe(4)
    expect(totalsByCard({ a: { normal: 2, foil: 1, promo: 0, condition: 'mint' }, b: { normal: 0, foil: 0, promo: 0, condition: 'mint' } })).toEqual({ a: 3 })
  })

  it('el bulk cuenta el total entre versiones', () => {
    const rows = bulkList({ a: { normal: 2, foil: 2, promo: 0, condition: 'played' }, b: { normal: 3, foil: 0, promo: 0, condition: 'mint' } })
    expect(rows).toEqual([{ cardId: 'a', total: 4, bulk: 1, condition: 'played' }])
  })

  it('sanea valores inválidos', () => {
    expect(sanitizeEntry({ normal: -4, foil: 2.9, promo: 99999, condition: 'roto' as never })).toEqual({ normal: 0, foil: 2, promo: 999, condition: 'mint' })
  })
})

describe('wishlist', () => {
  const decks = [realDeck(0), realDeck(1)]

  it('lista solo lo que falta y suma lo que piden varios mazos', () => {
    const rows = buildWishlist(decks, {}, catalog)
    const total = rows.reduce((a, r) => a + r.missing, 0)
    expect(total).toBe(decks.reduce((a, d) => a + Object.values(d.main).reduce((x, y) => x + y, 0) + d.legendIds.length, 0))
    expect(rows.every((r) => r.missing === r.needed - r.owned && r.missing > 0)).toBe(true)
  })

  it('descuenta lo que ya tienes', () => {
    const none = buildWishlist(decks, {}, catalog)
    const card = none[0]
    const some = buildWishlist(decks, { [card.cardId]: card.needed }, catalog)
    expect(some.find((r) => r.cardId === card.cardId)).toBeUndefined()
  })

  it('el CSV escapa comas/comillas y neutraliza fórmulas', () => {
    const csv = wishlistToCsv([{ cardId: 'x', code: '001', name: '=HYPERLINK("x")', set: 'A, B', rarity: 'Rare', needed: 3, owned: 1, missing: 2, decks: ['m1', 'm2'] }])
    const [header, line] = csv.split('\n')
    expect(header).toBe('code,name,set,rarity,needed,owned,missing,decks')
    expect(line).toContain(`"'=HYPERLINK(""x"")"`)
    expect(line).toContain('"A, B"')
  })

  it('el JSON es válido y conserva las filas', () => {
    const rows = buildWishlist(decks, {}, catalog)
    expect(JSON.parse(wishlistToJson(rows))).toHaveLength(rows.length)
  })
})

describe('código para compartir mazos', () => {
  it('ida y vuelta sin perder nada', async () => {
    const d = realDeck(4)
    const code = await encodeDeck(d)
    expect(code.startsWith('ncd1.')).toBe(true)
    const r = await decodeDeck(code, catalog)
    expect(r.ok && r.deck).toEqual({ name: d.name, legendIds: d.legendIds, main: d.main, side: d.side })
  })

  it('acepta el código dentro de una URL', async () => {
    const code = await encodeDeck(realDeck(0))
    const r = await decodeDeck(`https://x.github.io/app/#/share/${code}`, catalog)
    expect(r.ok).toBe(true)
  })

  it('el código es compacto', async () => {
    expect((await encodeDeck(realDeck(4))).length).toBeLessThan(900)
  })

  it('rechaza basura, códigos dañados y cartas inventadas', async () => {
    expect((await decodeDeck('hola', catalog)).ok).toBe(false)
    expect((await decodeDeck('ncd1.@@@', catalog)).ok).toBe(false)
    const evil = await encodeDeck({ name: 'x', legendIds: [], main: { carta_inventada: 3 }, side: {} })
    expect((await decodeDeck(evil, catalog)).ok).toBe(false)
  })
})

describe('bulk CSV', () => {
  it('exporta las copias sobrantes con su estado', async () => {
    const { bulkToCsv } = await import('./inventory')
    const csv = bulkToCsv([{ cardId: 'a', total: 5, bulk: 2, condition: 'played' }], () => ({ code: '001', name: 'Carta, rara', set: 'S', }))
    expect(csv.split('\n')).toEqual(['code,name,set,bulk_copies,condition', '001,"Carta, rara",S,2,Played'])
  })
})

describe('lista de deseos manual', () => {
  it('lista las cartas deseadas con lo que ya tienes, ordenadas por nombre', async () => {
    const { buildWants } = await import('./wishlist')
    const rows = buildWants({ saul_bright_stormrider: 2, goro_takemura_hands_unclean: 1 }, { saul_bright_stormrider: 1 }, catalog)
    expect(rows.map((r) => r.name)).toEqual(['Goro Takemura: Hands Unclean', 'Saul Bright: Stormrider'])
    expect(rows[1]).toMatchObject({ wanted: 2, owned: 1, code: '089' })
  })

  it('ignora cartas desconocidas y cantidades no positivas', async () => {
    const { buildWants } = await import('./wishlist')
    expect(buildWants({ inventada: 3, saul_bright_stormrider: 0, constructor: 2 } as never, {}, catalog)).toEqual([])
  })

  it('exporta a CSV y JSON válidos', async () => {
    const { buildWants, wantsToCsv, wantsToJson } = await import('./wishlist')
    const rows = buildWants({ saul_bright_stormrider: 2 }, {}, catalog)
    expect(wantsToCsv(rows).split('\n')[0]).toBe('code,name,set,rarity,wanted,owned')
    expect(JSON.parse(wantsToJson(rows))[0]).toMatchObject({ id: 'saul_bright_stormrider', wanted: 2 })
  })
})

describe('código de colores del mazo', () => {
  const byColor = (color: string) => catalog.cards.filter((c) => c.type === 'Legend' && c.color === color).map((c) => c.id)

  it('dos Green y un Red -> GGR (el color dominante primero)', async () => {
    const { colorCode } = await import('./colorCode')
    const [g1, g2] = byColor('Green')
    const [r1] = byColor('Red')
    const cc = colorCode([r1, g1, g2], catalog)
    expect(cc.code).toBe('GGR')
    expect(cc.label).toBe('GREEN · GREEN · RED')
  })

  it('dos Blue y un Green -> BBG', async () => {
    const { colorCode } = await import('./colorCode')
    const [b1, b2] = byColor('Blue')
    const [g1] = byColor('Green')
    expect(colorCode([g1, b1, b2], catalog).code).toBe('BBG')
  })

  it('tres colores distintos usan el orden canónico R-Y-B-G', async () => {
    const { colorCode } = await import('./colorCode')
    expect(colorCode([byColor('Blue')[0], byColor('Yellow')[0], byColor('Red')[0]], catalog).code).toBe('RYB')
  })

  it('con menos de 3 Legends o ids desconocidos no falla', async () => {
    const { colorCode } = await import('./colorCode')
    expect(colorCode([], catalog).code).toBe('')
    expect(colorCode(['inventada', byColor('Red')[0]], catalog).code).toBe('R')
  })
})

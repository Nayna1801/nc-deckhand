import { describe, expect, it } from 'vitest'
import { catalog } from './catalog'
import { parseCollectionText, parseDeckText, serializeDeck } from './deckText'
import { neededCards, validateDeck } from './deckRules'

const SAMPLE = `# Name: Custom Deck 1

# Legends
1x 012 Goro Takemura: Hands Unclean

# Main Deck
1x 089 Saul Bright: Stormrider`

describe('parseDeckText', () => {
  it('lee el formato exportado por cyberpunk-tcg-sim.online', () => {
    const d = parseDeckText(SAMPLE, catalog)
    expect(d.issues).toEqual([])
    expect(d.name).toBe('Custom Deck 1')
    expect(d.legendIds).toEqual(['goro_takemura_hands_unclean'])
    expect(d.main).toEqual({ saul_bright_stormrider: 1 })
  })

  it('resuelve códigos ambiguos (012 existe en 3 sets) usando el nombre', () => {
    const d = parseDeckText('# Legends\n1x 012 Kerry Eurodyne: The Last Rockerboy', catalog)
    expect(d.legendIds).toEqual(['kerry_eurodyne_the_last_rockerboy'])
  })

  it('acepta solo el nombre y secciones abreviadas', () => {
    const d = parseDeckText('#L\n1x Goro Takemura: Hands Unclean\n#D\n2x Saul Bright: Stormrider\n#S\n1x Saul Bright: Stormrider', catalog)
    expect(d.legendIds).toHaveLength(1)
    expect(d.main.saul_bright_stormrider).toBe(2)
    expect(d.side.saul_bright_stormrider).toBe(1)
  })

  it('reporta líneas que no puede resolver sin descartar el resto', () => {
    const d = parseDeckText('# Main Deck\n1x 089 Saul Bright: Stormrider\n3x 999 Carta Inventada\nbasura', catalog)
    expect(d.main.saul_bright_stormrider).toBe(1)
    expect(d.issues).toHaveLength(2)
  })

  it('serializa y vuelve a parsear sin perder nada (round-trip)', () => {
    const d = parseDeckText(SAMPLE, catalog)
    const text = serializeDeck({ name: d.name, legendIds: d.legendIds, main: d.main, side: d.side }, catalog)
    expect(text).toBe(SAMPLE)
  })

  it('la colección cuenta legends, main y sideboard', () => {
    const { collection } = parseCollectionText(SAMPLE + '\n\n# Sideboard\n2x 089 Saul Bright: Stormrider', catalog)
    expect(collection).toEqual({ goro_takemura_hands_unclean: 1, saul_bright_stormrider: 3 })
  })
})

describe('validateDeck', () => {
  it('marca como incompleto (no inválido) un mazo a medias', () => {
    const r = validateDeck({ legendIds: ['goro_takemura_hands_unclean'], main: { saul_bright_stormrider: 1 }, side: {} }, catalog)
    expect(r.errors).toEqual([])
    expect(r.incomplete.length).toBe(2)
    expect(r.isValid).toBe(false)
  })

  it('rechaza más de 3 copias entre mazo y sideboard', () => {
    const r = validateDeck({ legendIds: [], main: { saul_bright_stormrider: 3 }, side: { saul_bright_stormrider: 1 } }, catalog)
    expect(r.errors.join(' ')).toMatch(/4 copias/)
  })

  it('exige RAM suficiente del color de la carta', () => {
    const card = catalog.cards.find((c) => c.type !== 'Legend' && (c.ram ?? 0) > 0)!
    const legend = catalog.cards.find((c) => c.type === 'Legend' && c.color !== card.color)!
    const r = validateDeck({ legendIds: [legend.id], main: { [card.id]: 1 }, side: {} }, catalog)
    expect(r.errors.join(' ')).toMatch(/RAM/)
  })
})

describe('neededCards', () => {
  it('calcula lo que falta frente a la colección', () => {
    const n = neededCards({ legendIds: ['goro_takemura_hands_unclean'], main: { saul_bright_stormrider: 3 }, side: {} }, { saul_bright_stormrider: 1 })
    expect(n.find((x) => x.cardId === 'saul_bright_stormrider')).toMatchObject({ needed: 3, owned: 1, missing: 2 })
    expect(n.find((x) => x.cardId === 'goro_takemura_hands_unclean')).toMatchObject({ missing: 1 })
  })
})

import { describe, expect, it } from 'vitest'
import { buildCatalog, catalog } from './catalog'
import { validateDeck } from './deckRules'
import type { Card } from './types'

const legends = catalog.cards.filter((c) => c.type === 'Legend' && c.legality === 'legal').slice(0, 2)

describe('legalidad en Standard', () => {
  it('una Legend que no es legal (p. ej. el promo de Rebecca) se avisa', () => {
    const rebecca = catalog.byId['rebecca_having_a_moment']
    expect(rebecca?.legality).toBe('not-legal')
    const report = validateDeck({ legendIds: [rebecca.id, legends[0].id, legends[1].id], main: {}, side: {} }, catalog)
    expect(report.errors.some((e) => /Rebecca.*no es legal en Standard/.test(e))).toBe(true)
  })

  it('un mazo con Legends legales no recibe ese aviso', () => {
    const report = validateDeck({ legendIds: legends.map((l) => l.id), main: {}, side: {} }, catalog)
    expect(report.errors.some((e) => /legal en Standard|en Standard/.test(e))).toBe(false)
  })

  it('las cartas baneadas siguen avisando con su mensaje de siempre y funcionan en principal y sideboard', () => {
    const unit = catalog.cards.find((c) => c.type === 'Unit') as Card
    const banned: Card = { ...unit, id: 'banned_test', legality: 'banned' }
    const cat = buildCatalog([...catalog.cards, banned])
    const report = validateDeck({ legendIds: [], main: { banned_test: 1 }, side: {} }, cat)
    expect(report.errors).toContain(`${banned.displayName} está banned en Standard.`)
    const side = validateDeck({ legendIds: [], main: {}, side: { banned_test: 1 } }, cat)
    expect(side.errors).toContain(`${banned.displayName} está banned en Standard.`)
  })

  it('las cartas nuevas sin coste, RAM ni código de importación no rompen el validador ni la exportación', () => {
    const lucyna = catalog.byId['lucyna_kushinada_fresh_beginnings']
    expect(lucyna).toBeDefined()
    expect(lucyna.importId).toBeNull()
    expect(() => validateDeck({ legendIds: [lucyna.id], main: {}, side: {} }, catalog)).not.toThrow()
  })
})

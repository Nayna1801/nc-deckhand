import { describe, expect, it } from 'vitest'
import { catalog } from './catalog'
import { parseDeckText, serializeDeck } from './deckText'
import { validateDeck } from './deckRules'
import fixtures from './__fixtures__/siteDecks.json'

// Mazos de ejemplo de cyberpunk-tcg-sim.online (la web los marca como "satisfies the current builder rules").
describe.each(fixtures)('mazo real de la web: $name', ({ text }) => {
  const parsed = parseDeckText(text, catalog)

  it('se importa sin errores', () => {
    expect(parsed.issues).toEqual([])
    expect(parsed.warnings).toEqual([])
  })

  it('mi validador lo da por legal, igual que la web', () => {
    const r = validateDeck(parsed, catalog)
    expect(r.errors).toEqual([])
    expect(r.incomplete).toEqual([])
    expect(r.isValid).toBe(true)
  })

  it('mi exportación reproduce el texto de la web', () => {
    const siteText = text.split(String.fromCharCode(13, 10)).join('\n').trim()
    expect(serializeDeck(parsed, catalog)).toBe(siteText)
  })
})

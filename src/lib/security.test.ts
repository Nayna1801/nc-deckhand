import { describe, expect, it } from 'vitest'
import { catalog } from './catalog'
import { parseDeckText, MAX_IMPORT_CHARS } from './deckText'
import { decodeDeck, encodeDeck } from './shareCode'
import { sanitizeDecks } from './localDecks'

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw')))
  return new Uint8Array(await out.arrayBuffer())
}
const b64url = (b: Uint8Array) => {
  let s = ''
  b.forEach((x) => (s += String.fromCharCode(x)))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('códigos de mazo: bomba de descompresión', () => {
  it('rechaza una bomba que cabe en el tope de entrada (la frena la lectura limitada)', async () => {
    const bomb = await deflateRaw(new Uint8Array(4 * 1024 * 1024)) // 4 MB de ceros -> ~4 KB
    const code = 'ncd1.' + b64url(bomb)
    expect(code.length).toBeLessThan(8000)
    const t = Date.now()
    const r = await decodeDeck(code, catalog)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/grande/i)
    expect(Date.now() - t).toBeLessThan(1500)
  })

  it('rechaza una bomba enorme por tamaño de entrada', async () => {
    const code = 'ncd1.' + b64url(await deflateRaw(new Uint8Array(40 * 1024 * 1024)))
    expect(code.length).toBeGreaterThan(8000)
    const r = await decodeDeck(code, catalog)
    expect(r.ok).toBe(false)
  })

  it('no acepta ids heredados del prototipo (constructor, __proto__)', async () => {
    const evil = await encodeDeck({ name: 'x', legendIds: [], main: JSON.parse('{"constructor":3}'), side: {} })
    expect((await decodeDeck(evil, catalog)).ok).toBe(false)
  })

  it('rechaza entradas gigantes sin procesarlas', async () => {
    const r = await decodeDeck('ncd1.' + 'A'.repeat(2_000_000), catalog)
    expect(r.ok).toBe(false)
  })

  it('un mazo normal sigue funcionando', async () => {
    const d = { name: 'ok', legendIds: ['goro_takemura_hands_unclean'], main: { saul_bright_stormrider: 3 }, side: {} }
    const r = await decodeDeck(await encodeDeck(d), catalog)
    expect(r.ok).toBe(true)
  })

  it('rechaza cantidades absurdas dentro de un código válido', async () => {
    const r = await decodeDeck(await encodeDeck({ name: 'x', legendIds: [], main: { saul_bright_stormrider: 99999 }, side: {} }), catalog)
    expect(r.ok).toBe(false)
  })
})

describe('importación de texto: límites', () => {
  it('una línea de Legends con cantidad enorme no cuelga la página', () => {
    const t = Date.now()
    const p = parseDeckText('# Legends\n999999999x 012 Goro Takemura: Hands Unclean', catalog)
    expect(Date.now() - t).toBeLessThan(500)
    expect(p.legendIds.length).toBeLessThanOrEqual(3)
  })

  it('limita las cantidades a 99 y avisa', () => {
    const p = parseDeckText('# Main Deck\n5000x 089 Saul Bright: Stormrider', catalog)
    expect(p.main.saul_bright_stormrider).toBe(99)
    expect(p.warnings.join(' ')).toMatch(/99/)
  })

  it('rechaza textos enormes', () => {
    const p = parseDeckText('1x 089 Saul Bright: Stormrider\n'.repeat(MAX_IMPORT_CHARS), catalog)
    expect(p.issues[0].reason).toMatch(/demasiado grande/i)
    expect(Object.keys(p.main)).toHaveLength(0)
  })
})

describe('mazos guardados en el navegador (datos no fiables)', () => {
  const good = { id: 'deck-0001', name: 'Mi mazo', legendIds: ['goro_takemura_hands_unclean'], main: { saul_bright_stormrider: 3 }, side: {}, updatedAt: '2026-01-01T00:00:00.000Z' }

  it('acepta un mazo válido tal cual', () => {
    expect(sanitizeDecks([good], catalog)).toEqual([good])
  })

  it('descarta lo que no es una lista o no es un mazo', () => {
    expect(sanitizeDecks('hola', catalog)).toEqual([])
    expect(sanitizeDecks({ a: 1 }, catalog)).toEqual([])
    expect(sanitizeDecks([null, 5, 'x', [], {}], catalog)).toEqual([])
  })

  it('elimina cartas desconocidas y cantidades inválidas', () => {
    const [d] = sanitizeDecks(
      [{ ...good, legendIds: ['inventada', 'goro_takemura_hands_unclean'], main: { saul_bright_stormrider: 'mucho', carta_x: 2, ruthless_lowlife: 500, floor_it: -1, kiroshi_optics: 2 } }],
      catalog,
    )
    expect(d.legendIds).toEqual(['goro_takemura_hands_unclean'])
    expect(d.main).toEqual({ ruthless_lowlife: 99, kiroshi_optics: 2 })
  })

  it('limita nombre, Legends (3) y número de mazos', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ ...good, id: `d${i}`, name: 'x'.repeat(500) }))
    const out = sanitizeDecks(many, catalog)
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out[0].name.length).toBeLessThanOrEqual(64)
    const four = sanitizeDecks([{ ...good, legendIds: ['goro_takemura_hands_unclean', 'saburo_arasaka_stubborn_patriarch', 'yorinobu_arasaka_embracing_destruction', 'jackie_welles_pour_one_out_for_me'] }], catalog)
    expect(four[0].legendIds).toHaveLength(3)
  })

  it('regenera ids peligrosos y fechas inválidas', () => {
    const [d] = sanitizeDecks([{ ...good, id: '<img src=x onerror=alert(1)>', updatedAt: 'ayer' }], catalog)
    expect(d.id).toMatch(/^[\w-]{8,64}$/)
    expect(Number.isNaN(Date.parse(d.updatedAt))).toBe(false)
  })

  it('no se deja contaminar por __proto__', () => {
    const evil = JSON.parse('{"id":"p1","name":"x","legendIds":[],"main":{"__proto__":{"polluted":3},"kiroshi_optics":2},"side":{}}')
    const [d] = sanitizeDecks([evil], catalog)
    expect(d.main).toEqual({ kiroshi_optics: 2 })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

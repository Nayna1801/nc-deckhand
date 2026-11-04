import type { Catalog } from './catalog'
import type { Deck, Quantities } from './types'

const PREFIX = 'ncd1.'

type Payload = { n: string; l: string[]; m: Quantities; s: Quantities }

const toB64Url = (bytes: Uint8Array): string => {
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromB64Url = (s: string): Uint8Array => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

/** Código compartible y autocontenido (sin servidor): JSON comprimido en base64url. */
export async function encodeDeck(deck: Pick<Deck, 'name' | 'legendIds' | 'main' | 'side'>): Promise<string> {
  const payload: Payload = { n: deck.name, l: deck.legendIds, m: deck.main, s: deck.side }
  const raw = new TextEncoder().encode(JSON.stringify(payload))
  return PREFIX + toB64Url(await pipe(raw, new CompressionStream('deflate-raw')))
}

const isQuantities = (v: unknown, catalog: Catalog): v is Quantities =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.entries(v).every(([id, n]) => id in catalog.byId && Number.isInteger(n) && (n as number) > 0 && (n as number) <= 99)

export type DecodeResult = { ok: true; deck: Pick<Deck, 'name' | 'legendIds' | 'main' | 'side'> } | { ok: false; error: string }

/** Valida todo lo que entra: el código viene de fuera, así que nunca se confía en su contenido. */
export async function decodeDeck(code: string, catalog: Catalog): Promise<DecodeResult> {
  const trimmed = code.trim().replace(/^.*[#/]/, '')
  if (!trimmed.startsWith(PREFIX)) return { ok: false, error: 'No es un código de mazo válido.' }
  try {
    const raw = await pipe(fromB64Url(trimmed.slice(PREFIX.length)), new DecompressionStream('deflate-raw'))
    if (raw.byteLength > 64 * 1024) return { ok: false, error: 'El código es demasiado grande.' }
    const p = JSON.parse(new TextDecoder().decode(raw)) as Partial<Payload>
    const legends = Array.isArray(p.l) ? p.l : null
    if (!legends || legends.length > 3 || !legends.every((id) => typeof id === 'string' && id in catalog.byId)) {
      return { ok: false, error: 'El código contiene Legends desconocidas.' }
    }
    if (!isQuantities(p.m, catalog) || !isQuantities(p.s, catalog)) return { ok: false, error: 'El código contiene cartas desconocidas.' }
    const name = typeof p.n === 'string' && p.n.trim() ? p.n.trim().slice(0, 64) : 'Mazo compartido'
    return { ok: true, deck: { name, legendIds: legends, main: p.m, side: p.s } }
  } catch {
    return { ok: false, error: 'El código está dañado o incompleto.' }
  }
}

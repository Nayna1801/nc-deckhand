import { isCardId, type Catalog } from './catalog'
import type { Deck, Quantities } from './types'

const PREFIX = 'ncd1.'
export const MAX_CODE_LENGTH = 8000
const MAX_DECODED_BYTES = 64 * 1024

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

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw')))
  return new Uint8Array(await out.arrayBuffer())
}

/** Descomprime leyendo a trozos y abortando al pasar del tope: protege frente a "bombas" (pocos KB -> cientos de MB). */
async function inflateCapped(bytes: Uint8Array, max: number): Promise<Uint8Array | null> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

/** Código compartible y autocontenido (sin servidor): JSON comprimido en base64url. */
export async function encodeDeck(deck: Pick<Deck, 'name' | 'legendIds' | 'main' | 'side'>): Promise<string> {
  const payload: Payload = { n: deck.name, l: deck.legendIds, m: deck.main, s: deck.side }
  const raw = new TextEncoder().encode(JSON.stringify(payload))
  return PREFIX + toB64Url(await deflate(raw))
}

const isQuantities = (v: unknown, catalog: Catalog): v is Quantities =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.entries(v).every(([id, n]) => isCardId(id, catalog) && Number.isInteger(n) && (n as number) > 0 && (n as number) <= 99)

export type DecodeResult = { ok: true; deck: Pick<Deck, 'name' | 'legendIds' | 'main' | 'side'> } | { ok: false; error: string }

const TOO_BIG: DecodeResult = { ok: false, error: 'El código es demasiado grande.' }

/** Valida todo lo que entra: el código viene de fuera, así que nunca se confía en su contenido. */
export async function decodeDeck(code: string, catalog: Catalog): Promise<DecodeResult> {
  if (typeof code !== 'string' || code.length > MAX_CODE_LENGTH * 2) return TOO_BIG
  const trimmed = code.trim().replace(/^.*[#/]/, '')
  if (trimmed.length > MAX_CODE_LENGTH) return TOO_BIG
  if (!trimmed.startsWith(PREFIX)) return { ok: false, error: 'No es un código de mazo válido.' }
  try {
    const raw = await inflateCapped(fromB64Url(trimmed.slice(PREFIX.length)), MAX_DECODED_BYTES)
    if (!raw) return TOO_BIG
    const p = JSON.parse(new TextDecoder().decode(raw)) as Partial<Payload>
    const legends = Array.isArray(p.l) ? p.l : null
    if (!legends || legends.length > 3 || !legends.every((id) => isCardId(id, catalog))) {
      return { ok: false, error: 'El código contiene Legends desconocidas.' }
    }
    if (!isQuantities(p.m, catalog) || !isQuantities(p.s, catalog)) return { ok: false, error: 'El código contiene cartas desconocidas.' }
    const name = typeof p.n === 'string' && p.n.trim() ? p.n.trim().slice(0, 64) : 'Mazo compartido'
    return { ok: true, deck: { name, legendIds: legends, main: p.m, side: p.s } }
  } catch {
    return { ok: false, error: 'El código está dañado o incompleto.' }
  }
}

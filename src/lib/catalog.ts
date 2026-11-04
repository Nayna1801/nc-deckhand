import raw from '../data/cards.json'
import type { Card } from './types'

export const normalizeText = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Código de import normalizado: "SD02-012" / "ms01-012" / "012" -> "012". */
export function normalizeCode(code: string): string {
  const c = code
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, '')
  const m = c.match(/^(?:MS\d+|SD\d+)-?([0-9]{3}[A-Z]?)$/)
  return (m ? m[1] : c).toLowerCase().replace(/[^a-z0-9]/g, '')
}

export interface Catalog {
  cards: Card[]
  byId: Record<string, Card>
  byCode: Record<string, Card[]>
  byName: Record<string, Card[]>
}

export function buildCatalog(cards: Card[]): Catalog {
  // sin prototipo: 'constructor', '__proto__'… no cuentan como ids ni nombres válidos
  const byId: Record<string, Card> = Object.create(null)
  const byCode: Record<string, Card[]> = Object.create(null)
  const byName: Record<string, Card[]> = Object.create(null)
  for (const card of cards) {
    byId[card.id] = card
    const code = card.importId ? normalizeCode(card.importId) : ''
    if (code) (byCode[code] ??= []).push(card)
    for (const n of new Set([normalizeText(card.displayName), normalizeText(card.name)])) {
      if (n) (byName[n] ??= []).push(card)
    }
  }
  return { cards, byId, byCode, byName }
}

export const catalog: Catalog = buildCatalog(raw as Card[])

/** Orden de los sets al listar: el set principal primero y después los mazos de inicio. */
export const SET_ORDER = ['welcometonightcityretail', 'embracingpowerretailstarterdeck', 'theheistretailstarterdeck']

export const setIndex = (c: Pick<Card, 'setCode'>): number => {
  const i = SET_ORDER.indexOf(c.setCode)
  return i === -1 ? SET_ORDER.length : i
}

const collectorNumber = (c: Pick<Card, 'importId'>): number => parseInt(c.importId ?? '', 10) || 0

/** Orden por defecto: por set y, dentro de cada set, por número de coleccionista. */
export function compareBySetAndNumber(a: Card, b: Card): number {
  return (
    setIndex(a) - setIndex(b) ||
    a.setCode.localeCompare(b.setCode) ||
    collectorNumber(a) - collectorNumber(b) ||
    a.displayName.localeCompare(b.displayName)
  )
}

export const isCardId =(id: unknown, cat: Catalog = catalog): id is string => typeof id === 'string' && id in cat.byId

export const COLORS =['Red', 'Yellow', 'Blue', 'Green'] as const
export const TYPES = ['Legend', 'Unit', 'Gear', 'Program'] as const
export const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Secret'] as const

export function setLabel(card: Pick<Card, 'setName'>): string {
  return card.setName.replace(/\s*—\s*Retail( Starter Deck)?$/i, '$1').trim()
}

/** Clave para limitar copias "por carta" aunque existan varias impresiones con el mismo nombre. */
export const copyKey = (card: Card): string => normalizeText(card.displayName)

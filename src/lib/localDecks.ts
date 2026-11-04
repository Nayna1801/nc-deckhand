import type { Deck } from './types'

const KEY = 'ncd.guestDecks.v1'

export function loadLocalDecks(): Deck[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as Deck[]) : []
  } catch {
    return []
  }
}

export function saveLocalDecks(decks: Deck[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(decks))
  } catch {
    // almacenamiento lleno o bloqueado: la UI sigue funcionando en memoria
  }
}

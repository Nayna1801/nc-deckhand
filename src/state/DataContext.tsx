import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { loadLocalDecks, saveLocalDecks } from '../lib/localDecks'
import type { Collection, Deck, Quantities } from '../lib/types'
import { useAuth } from './AuthContext'

interface DataState {
  loggedIn: boolean
  loading: boolean
  error: string | null
  decks: Deck[]
  /** Decks de invitado guardados en este navegador (solo se muestran al iniciar sesión, para subirlos). */
  guestDecks: Deck[]
  collection: Collection
  createDeck: (init?: Partial<Pick<Deck, 'name' | 'legendIds' | 'main' | 'side'>>) => Promise<Deck | null>
  saveDeck: (deck: Deck) => Promise<void>
  deleteDeck: (id: string) => Promise<void>
  setOwned: (cardId: string, quantity: number) => Promise<void>
  replaceCollection: (next: Quantities) => Promise<void>
  uploadGuestDecks: () => Promise<void>
  clearError: () => void
}

const Ctx = createContext<DataState | null>(null)

interface DeckRow {
  id: string
  name: string
  legend_ids: string[]
  main: Quantities
  side: Quantities
  updated_at: string
}

const fromRow = (r: DeckRow): Deck => ({ id: r.id, name: r.name, legendIds: r.legend_ids ?? [], main: r.main ?? {}, side: r.side ?? {}, updatedAt: r.updated_at })
const toRow = (d: Deck, userId: string) => ({ id: d.id, user_id: userId, name: d.name, legend_ids: d.legendIds, main: d.main, side: d.side, updated_at: new Date().toISOString() })
const newId = (): string => crypto.randomUUID()

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [decks, setDecks] = useState<Deck[]>(() => loadLocalDecks())
  const [guestDecks, setGuestDecks] = useState<Deck[]>(() => loadLocalDecks())
  const [collection, setCollection] = useState<Collection>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const collectionRef = useRef(collection)
  collectionRef.current = collection

  // Carga al iniciar/cerrar sesión
  useEffect(() => {
    if (!userId || !supabase) {
      setDecks(loadLocalDecks())
      setGuestDecks([])
      setCollection({})
      return
    }
    let active = true
    setLoading(true)
    setGuestDecks(loadLocalDecks())
    Promise.all([
      supabase.from('tcg_decks').select('*').order('updated_at', { ascending: false }),
      supabase.from('tcg_collection').select('card_id, quantity').limit(5000),
    ])
      .then(([d, c]) => {
        if (!active) return
        if (d.error) throw d.error
        if (c.error) throw c.error
        setDecks((d.data as DeckRow[]).map(fromRow))
        setCollection(Object.fromEntries((c.data as { card_id: string; quantity: number }[]).map((r) => [r.card_id, r.quantity])))
      })
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : 'No se pudieron cargar tus datos.'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [userId])

  const value = useMemo<DataState>(() => {
    const fail = (e: unknown, fallback: string) => setError(e instanceof Error ? e.message : (e as { message?: string } | null)?.message ?? fallback)

    const saveDeck = async (deck: Deck) => {
      const stamped = { ...deck, updatedAt: new Date().toISOString() }
      setDecks((prev) => {
        const next = prev.some((d) => d.id === deck.id) ? prev.map((d) => (d.id === deck.id ? stamped : d)) : [stamped, ...prev]
        if (!userId) saveLocalDecks(next)
        return next
      })
      if (userId && supabase) {
        const { error: e } = await supabase.from('tcg_decks').upsert(toRow(stamped, userId))
        if (e) fail(e, 'No se pudo guardar el mazo.')
      }
    }

    return {
      loggedIn: userId !== null,
      loading,
      error,
      decks,
      guestDecks,
      collection,
      clearError: () => setError(null),
      createDeck: async (init = {}) => {
        const deck: Deck = { id: newId(), name: init.name ?? 'Nuevo mazo', legendIds: init.legendIds ?? [], main: init.main ?? {}, side: init.side ?? {}, updatedAt: new Date().toISOString() }
        await saveDeck(deck)
        return deck
      },
      saveDeck,
      deleteDeck: async (id) => {
        if (userId && supabase) {
          const { error: e } = await supabase.from('tcg_decks').delete().eq('id', id)
          if (e) return fail(e, 'No se pudo borrar el mazo.')
        }
        setDecks((prev) => {
          const next = prev.filter((d) => d.id !== id)
          if (!userId) saveLocalDecks(next)
          return next
        })
      },
      setOwned: async (cardId, quantity) => {
        if (!userId || !supabase) return
        const q = Math.max(0, Math.min(999, Math.floor(quantity)))
        const prev = collectionRef.current
        const next = { ...prev }
        if (q === 0) delete next[cardId]
        else next[cardId] = q
        setCollection(next) // optimista
        const { error: e } =
          q === 0
            ? await supabase.from('tcg_collection').delete().eq('user_id', userId).eq('card_id', cardId)
            : await supabase.from('tcg_collection').upsert({ user_id: userId, card_id: cardId, quantity: q, updated_at: new Date().toISOString() })
        if (e) {
          setCollection(prev) // revertir
          fail(e, 'No se pudo guardar la cantidad.')
        }
      },
      replaceCollection: async (nextCol) => {
        if (!userId || !supabase) return
        const prev = collectionRef.current
        const clean = Object.fromEntries(Object.entries(nextCol).filter(([, n]) => n > 0).map(([id, n]) => [id, Math.min(999, n)]))
        setCollection(clean)
        const rows = Object.entries(clean).map(([card_id, quantity]) => ({ user_id: userId, card_id, quantity, updated_at: new Date().toISOString() }))
        const removed = Object.keys(prev).filter((id) => !(id in clean))
        const ops = [
          rows.length ? supabase.from('tcg_collection').upsert(rows) : null,
          removed.length ? supabase.from('tcg_collection').delete().eq('user_id', userId).in('card_id', removed) : null,
        ].filter((o) => o !== null)
        const results = await Promise.all(ops)
        const failed = results.find((r) => r.error)
        if (failed?.error) {
          setCollection(prev)
          fail(failed.error, 'No se pudo guardar la colección.')
        }
      },
      uploadGuestDecks: async () => {
        if (!userId || !supabase) return
        const local = loadLocalDecks()
        if (local.length === 0) return
        const rows = local.map((d) => toRow({ ...d, id: newId() }, userId))
        const { data, error: e } = await supabase.from('tcg_decks').insert(rows).select('*')
        if (e) return fail(e, 'No se pudieron subir los mazos.')
        saveLocalDecks([])
        setGuestDecks([])
        setDecks((prev) => [...(data as DeckRow[]).map(fromRow), ...prev])
      },
    }
  }, [userId, loading, error, decks, guestDecks, collection])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData(): DataState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData fuera de DataProvider')
  return v
}

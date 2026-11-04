import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { loadLocalDecks, saveLocalDecks } from '../lib/localDecks'
import { EMPTY_ENTRY, sanitizeEntry, totalOf, totalsByCard, type Inventory, type InventoryEntry } from '../lib/inventory'
import type { Collection, Deck, Quantities } from '../lib/types'
import { useAuth } from './AuthContext'

interface DataState {
  loggedIn: boolean
  loading: boolean
  error: string | null
  decks: Deck[]
  /** Decks de invitado guardados en este navegador (solo se muestran al iniciar sesión, para subirlos). */
  guestDecks: Deck[]
  /** Total de copias por carta (Normal + Foil + Promo): lo que usan las reglas y los mazos. */
  collection: Collection
  /** Detalle por versión y estado. */
  inventory: Inventory
  /** false si la base de datos aún no tiene las columnas de Foil/Promo/estado (falta re-ejecutar schema.sql). */
  inventoryV2: boolean
  createDeck: (init?: Partial<Pick<Deck, 'name' | 'legendIds' | 'main' | 'side'>>) => Promise<Deck | null>
  saveDeck: (deck: Deck) => Promise<void>
  deleteDeck: (id: string) => Promise<void>
  /** Cambia las copias Normal de una carta (botones rápidos +/−). */
  setOwned: (cardId: string, quantity: number) => Promise<void>
  setInventory: (cardId: string, patch: Partial<InventoryEntry>) => Promise<void>
  /** Importa cantidades: 'add' las suma a las Normal; 'replace' sustituye todo el inventario. */
  importCollection: (counts: Quantities, mode: 'add' | 'replace') => Promise<void>
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

interface CollectionRow {
  card_id: string
  quantity: number
  qty_foil?: number
  qty_promo?: number
  condition?: string
}

const fromRow = (r: DeckRow): Deck => ({ id: r.id, name: r.name, legendIds: r.legend_ids ?? [], main: r.main ?? {}, side: r.side ?? {}, updatedAt: r.updated_at })
const toRow = (d: Deck, userId: string) => ({ id: d.id, user_id: userId, name: d.name, legend_ids: d.legendIds, main: d.main, side: d.side, updated_at: new Date().toISOString() })
const newId = (): string => crypto.randomUUID()

const entryFromRow = (r: CollectionRow): InventoryEntry =>
  sanitizeEntry({ normal: r.quantity, foil: r.qty_foil, promo: r.qty_promo, condition: r.condition as InventoryEntry['condition'] })

const rowFromEntry = (userId: string, cardId: string, e: InventoryEntry, v2: boolean) => ({
  user_id: userId,
  card_id: cardId,
  quantity: e.normal,
  ...(v2 ? { qty_foil: e.foil, qty_promo: e.promo, condition: e.condition } : {}),
  updated_at: new Date().toISOString(),
})

const isMissingColumn = (e: { message?: string } | null): boolean => /qty_foil|qty_promo|condition|column/i.test(e?.message ?? '')

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [decks, setDecks] = useState<Deck[]>(() => loadLocalDecks())
  const [guestDecks, setGuestDecks] = useState<Deck[]>(() => loadLocalDecks())
  const [inventory, setInventoryState] = useState<Inventory>({})
  const [inventoryV2, setInventoryV2] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inventoryRef = useRef(inventory)
  inventoryRef.current = inventory
  const v2Ref = useRef(true)
  v2Ref.current = inventoryV2

  const collection = useMemo(() => totalsByCard(inventory), [inventory])

  // Carga al iniciar/cerrar sesión
  useEffect(() => {
    if (!userId || !supabase) {
      setDecks(loadLocalDecks())
      setGuestDecks([])
      setInventoryState({})
      return
    }
    const client = supabase
    let active = true
    setLoading(true)
    setGuestDecks(loadLocalDecks())

    async function loadInventory(): Promise<{ rows: CollectionRow[]; v2: boolean }> {
      const full = await client.from('tcg_collection').select('card_id, quantity, qty_foil, qty_promo, condition').limit(5000)
      if (!full.error) return { rows: full.data as CollectionRow[], v2: true }
      if (!isMissingColumn(full.error)) throw full.error
      const basic = await client.from('tcg_collection').select('card_id, quantity').limit(5000)
      if (basic.error) throw basic.error
      return { rows: basic.data as CollectionRow[], v2: false }
    }

    Promise.all([client.from('tcg_decks').select('*').order('updated_at', { ascending: false }), loadInventory()])
      .then(([d, inv]) => {
        if (!active) return
        if (d.error) throw d.error
        setDecks((d.data as DeckRow[]).map(fromRow))
        setInventoryV2(inv.v2)
        setInventoryState(Object.fromEntries(inv.rows.map((r) => [r.card_id, entryFromRow(r)])))
      })
      .catch((e: unknown) => active && setError(e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'No se pudieron cargar tus datos.'))
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

    const setInventory = async (cardId: string, patch: Partial<InventoryEntry>) => {
      if (!userId || !supabase) return
      const prev = inventoryRef.current
      const entry = sanitizeEntry({ ...(prev[cardId] ?? EMPTY_ENTRY), ...patch })
      // sin versión 2 solo existen las copias Normal
      const stored = v2Ref.current ? entry : { ...entry, foil: 0, promo: 0, condition: 'mint' as const }
      const next = { ...prev }
      if (totalOf(stored) === 0) delete next[cardId]
      else next[cardId] = stored
      setInventoryState(next) // optimista
      const { error: e } =
        totalOf(stored) === 0
          ? await supabase.from('tcg_collection').delete().eq('user_id', userId).eq('card_id', cardId)
          : await supabase.from('tcg_collection').upsert(rowFromEntry(userId, cardId, stored, v2Ref.current))
      if (e) {
        setInventoryState(prev) // revertir
        fail(e, 'No se pudo guardar el inventario.')
      }
    }

    return {
      loggedIn: userId !== null,
      loading,
      error,
      decks,
      guestDecks,
      collection,
      inventory,
      inventoryV2,
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
      setOwned: (cardId, quantity) => setInventory(cardId, { normal: quantity }),
      setInventory,
      importCollection: async (counts, mode) => {
        if (!userId || !supabase) return
        const prev = inventoryRef.current
        const next: Inventory = mode === 'replace' ? {} : { ...prev }
        for (const [id, n] of Object.entries(counts)) {
          if (!(n > 0)) continue
          const base = mode === 'replace' ? EMPTY_ENTRY : (prev[id] ?? EMPTY_ENTRY)
          next[id] = sanitizeEntry({ ...base, normal: base.normal + n })
        }
        setInventoryState(next)
        const rows = Object.entries(next).map(([id, e]) => rowFromEntry(userId, id, e, v2Ref.current))
        const removed = Object.keys(prev).filter((id) => !(id in next))
        const results = await Promise.all(
          [
            rows.length ? supabase.from('tcg_collection').upsert(rows) : null,
            removed.length ? supabase.from('tcg_collection').delete().eq('user_id', userId).in('card_id', removed) : null,
          ].filter((o) => o !== null),
        )
        const failed = results.find((r) => r.error)
        if (failed?.error) {
          setInventoryState(prev)
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
  }, [userId, loading, error, decks, guestDecks, collection, inventory, inventoryV2])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData(): DataState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData fuera de DataProvider')
  return v
}

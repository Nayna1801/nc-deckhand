import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { createKeyedWriter, type KeyedWriter } from '../lib/keyedWriter'
import { loadLocalDecks, saveLocalDecks } from '../lib/localDecks'
import { catalog } from '../lib/catalog'
import { adjustCopies, EMPTY_ENTRY, playsetSize, sanitizeArts, sanitizeEntry, totalOf, totalsByCard, withdrawBulk, type Inventory, type InventoryEntry, type Withdrawal } from '../lib/inventory'
import type { Collection, Deck, Quantities } from '../lib/types'
import { useAuth } from './AuthContext'

interface DataState {
  loggedIn: boolean
  loading: boolean
  /** true cuando ya se han leído tus datos del servidor; hasta entonces no se puede modificar el inventario ni los deseos. */
  ready: boolean
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
  /** false si la base de datos aún no tiene la columna `arts` (contar artes alternativos); falta re-ejecutar schema.sql. */
  artsAvailable: boolean
  /** Fija las copias de un arte alternativo o promo concreto (clave de `variantsOf`). */
  setArtCopies: (cardId: string, artKey: string, quantity: number) => Promise<void>
  /** Cartas que quieres conseguir (copias por carta), estén o no en un mazo. */
  wishlist: Quantities
  /** false si la tabla de deseos aún no existe en la base de datos (falta re-ejecutar schema.sql). */
  wishlistAvailable: boolean
  setWanted: (cardId: string, quantity: number) => Promise<void>
  createDeck: (init?: Partial<Pick<Deck, 'name' | 'legendIds' | 'main' | 'side'>>) => Promise<Deck | null>
  saveDeck: (deck: Deck) => Promise<void>
  deleteDeck: (id: string) => Promise<void>
  /** Ajusta el TOTAL de copias (botones rápidos +/−): + añade una Normal; − quita Normal, luego Promo, luego Foil. */
  changeCopies: (cardId: string, delta: number) => Promise<void>
  setInventory: (cardId: string, patch: Partial<InventoryEntry>) => Promise<void>
  /** Retira copias del bulk de varias cartas a la vez (vendidas, regaladas o cambiadas); nunca baja del playset. */
  withdrawBulk: (items: Withdrawal[]) => Promise<void>
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
  arts?: unknown
}

const fromRow = (r: DeckRow): Deck => ({ id: r.id, name: r.name, legendIds: r.legend_ids ?? [], main: r.main ?? {}, side: r.side ?? {}, updatedAt: r.updated_at })
const toRow = (d: Deck, userId: string) => ({ id: d.id, user_id: userId, name: d.name, legend_ids: d.legendIds, main: d.main, side: d.side, updated_at: new Date().toISOString() })
const newId = (): string => crypto.randomUUID()

const entryFromRow = (r: CollectionRow): InventoryEntry =>
  sanitizeEntry({ normal: r.quantity, foil: r.qty_foil, promo: r.qty_promo, arts: sanitizeArts(r.arts), condition: r.condition as InventoryEntry['condition'] })

/** Qué columnas opcionales tiene la tabla: v2 = Foil/Promo/estado; arts = copias por arte alternativo. */
interface Capabilities {
  v2: boolean
  arts: boolean
}

const rowFromEntry = (userId: string, cardId: string, e: InventoryEntry, cap: Capabilities) => ({
  user_id: userId,
  card_id: cardId,
  quantity: e.normal,
  ...(cap.v2 ? { qty_foil: e.foil, qty_promo: e.promo, condition: e.condition } : {}),
  ...(cap.arts ? { arts: e.arts } : {}),
  updated_at: new Date().toISOString(),
})

const isMissingColumn = (e: { message?: string } | null): boolean => /qty_foil|qty_promo|condition|arts|column/i.test(e?.message ?? '')
const isMissingTable = (e: { message?: string; code?: string } | null): boolean =>
  e?.code === 'PGRST205' || e?.code === '42P01' || /tcg_wishlist|schema cache|does not exist|relation/i.test(e?.message ?? '')

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [decks, setDecks] = useState<Deck[]>(() => loadLocalDecks())
  const [guestDecks, setGuestDecks] = useState<Deck[]>(() => loadLocalDecks())
  const [inventory, setInventoryState] = useState<Inventory>({})
  const [inventoryV2, setInventoryV2] = useState(true)
  const [artsAvailable, setArtsAvailable] = useState(true)
  const [wishlist, setWishlistState] = useState<Quantities>({})
  const [wishlistAvailable, setWishlistAvailable] = useState(true)
  const [loading, setLoading] = useState(false)
  // true solo cuando YA se han leído tus datos del servidor: antes de eso no se permite escribir, porque una
  // escritura sobre un inventario aún vacío pisaría lo que tienes guardado (p. ej. 3 copias -> 1).
  const [loaded, setLoaded] = useState(false)
  const loadedRef = useRef(false)
  loadedRef.current = loaded
  const [error, setError] = useState<string | null>(null)
  const inventoryRef = useRef(inventory)
  inventoryRef.current = inventory
  const v2Ref = useRef(true)
  const artsRef = useRef(true)
  artsRef.current = artsAvailable
  v2Ref.current = inventoryV2
  const wishlistRef = useRef(wishlist)
  wishlistRef.current = wishlist

  const collection = useMemo(() => totalsByCard(inventory), [inventory])

  // Escrituras en orden y de una en una por carta/mazo: si no, con pulsaciones rápidas las peticiones se
  // adelantan unas a otras y el servidor se queda con un valor viejo (la pantalla dice 2 y la base de datos 3).
  const userIdRef = useRef(userId)
  userIdRef.current = userId
  const confirmedInv = useRef<Inventory>({}) // último estado CONFIRMADO por el servidor
  const confirmedWish = useRef<Quantities>({})
  const writers = useRef<{ inv: KeyedWriter<InventoryEntry>; wish: KeyedWriter<number>; deck: KeyedWriter<Deck> } | null>(null)
  if (!writers.current) {
    writers.current = {
      inv: createKeyedWriter<InventoryEntry>(async (cardId, entry) => {
        const uid = userIdRef.current
        if (!uid || !supabase) return
        const empty = totalOf(entry) === 0
        const { error: e } = empty
          ? await supabase.from('tcg_collection').delete().eq('user_id', uid).eq('card_id', cardId)
          : await supabase.from('tcg_collection').upsert(rowFromEntry(uid, cardId, entry, { v2: v2Ref.current, arts: artsRef.current }))
        if (e) throw e
        const next = { ...confirmedInv.current }
        if (empty) delete next[cardId]
        else next[cardId] = entry
        confirmedInv.current = next
      }),
      wish: createKeyedWriter<number>(async (cardId, quantity) => {
        const uid = userIdRef.current
        if (!uid || !supabase) return
        const { error: e } =
          quantity === 0
            ? await supabase.from('tcg_wishlist').delete().eq('user_id', uid).eq('card_id', cardId)
            : await supabase.from('tcg_wishlist').upsert({ user_id: uid, card_id: cardId, quantity })
        if (e) throw e
        const next = { ...confirmedWish.current }
        if (quantity === 0) delete next[cardId]
        else next[cardId] = quantity
        confirmedWish.current = next
      }),
      deck: createKeyedWriter<Deck>(async (_id, deck) => {
        const uid = userIdRef.current
        if (!uid || !supabase) return
        const { error: e } = await supabase.from('tcg_decks').upsert(toRow(deck, uid))
        if (e) throw e
      }),
    }
  }

  // Carga al iniciar/cerrar sesión
  useEffect(() => {
    setLoaded(false)
    if (!userId || !supabase) {
      setDecks(loadLocalDecks())
      setGuestDecks([])
      setInventoryState({})
      setWishlistState({})
      return
    }
    const client = supabase
    let active = true
    setLoading(true)
    setGuestDecks(loadLocalDecks())

    // De la versión más completa de la tabla a la más antigua: se usa la primera que el servidor acepta.
    async function loadInventory(): Promise<{ rows: CollectionRow[]; cap: Capabilities }> {
      const tiers: { select: string; cap: Capabilities }[] = [
        { select: 'card_id, quantity, qty_foil, qty_promo, condition, arts', cap: { v2: true, arts: true } },
        { select: 'card_id, quantity, qty_foil, qty_promo, condition', cap: { v2: true, arts: false } },
        { select: 'card_id, quantity', cap: { v2: false, arts: false } },
      ]
      for (const [i, t] of tiers.entries()) {
        const r = await client.from('tcg_collection').select(t.select).limit(5000)
        if (!r.error) return { rows: r.data as unknown as CollectionRow[], cap: t.cap }
        if (!isMissingColumn(r.error) || i === tiers.length - 1) throw r.error
      }
      throw new Error('No se pudo leer la colección.')
    }

    async function loadWishlist(): Promise<{ rows: { card_id: string; quantity: number }[]; available: boolean }> {
      const w = await client.from('tcg_wishlist').select('card_id, quantity').limit(5000)
      if (!w.error) return { rows: w.data as { card_id: string; quantity: number }[], available: true }
      // tabla inexistente (schema.sql sin re-ejecutar): la función se desactiva sin romper el resto
      if (isMissingTable(w.error)) return { rows: [], available: false }
      throw w.error
    }

    Promise.all([client.from('tcg_decks').select('*').order('updated_at', { ascending: false }), loadInventory(), loadWishlist()])
      .then(([d, inv, wish]) => {
        if (!active) return
        if (d.error) throw d.error
        setDecks((d.data as DeckRow[]).map(fromRow))
        const invMap = Object.fromEntries(inv.rows.map((r) => [r.card_id, entryFromRow(r)]))
        const wishMap = Object.fromEntries(wish.rows.map((r) => [r.card_id, r.quantity]))
        confirmedInv.current = invMap
        confirmedWish.current = wishMap
        v2Ref.current = inv.cap.v2
        artsRef.current = inv.cap.arts
        setInventoryV2(inv.cap.v2)
        setArtsAvailable(inv.cap.arts)
        setInventoryState(invMap)
        setWishlistAvailable(wish.available)
        setWishlistState(wishMap)
        setLoaded(true)
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
        try {
          await writers.current!.deck.write(deck.id, stamped)
        } catch (e) {
          fail(e, 'No se pudo guardar el mazo.')
        }
      }
    }

    const restoreInventory = (cardId: string) =>
      setInventoryState((s) => {
        const n = { ...s }
        const c = confirmedInv.current[cardId]
        if (c) n[cardId] = c
        else delete n[cardId]
        return n
      })

    const restoreWishlist = (cardId: string) =>
      setWishlistState((s) => {
        const n = { ...s }
        const c = confirmedWish.current[cardId]
        if (c) n[cardId] = c
        else delete n[cardId]
        return n
      })

    const setInventory = async (cardId: string, patch: Partial<InventoryEntry>) => {
      if (!userId || !supabase || !loadedRef.current) return
      const prev = inventoryRef.current
      const entry = sanitizeEntry({ ...(prev[cardId] ?? EMPTY_ENTRY), ...patch })
      // sin versión 2 solo existen las copias Normal
      const v2 = v2Ref.current ? entry : { ...entry, foil: 0, promo: 0, condition: 'mint' as const }
      // sin la columna `arts` no se pueden guardar artes: no se anotan para no mostrar lo que no queda guardado
      const stored = artsRef.current ? v2 : { ...v2, arts: {} }
      const next = { ...prev }
      if (totalOf(stored) === 0) delete next[cardId]
      else next[cardId] = stored
      setInventoryState(next) // optimista: la pantalla responde al instante
      try {
        await writers.current!.inv.write(cardId, stored)
      } catch (e) {
        restoreInventory(cardId) // vuelve a lo último que confirmó el servidor
        fail(e, 'No se pudo guardar el inventario.')
      }
    }

    const setWanted = async (cardId: string, quantity: number) => {
      if (!userId || !supabase || !wishlistAvailable || !loadedRef.current) return
      const q = Math.max(0, Math.min(99, Math.floor(Number(quantity) || 0)))
      const prev = wishlistRef.current
      const next = { ...prev }
      if (q === 0) delete next[cardId]
      else next[cardId] = q
      setWishlistState(next) // optimista
      try {
        await writers.current!.wish.write(cardId, q)
      } catch (e) {
        restoreWishlist(cardId)
        fail(e, 'No se pudo guardar la lista de deseos.')
      }
    }

    return {
      loggedIn: userId !== null,
      loading,
      ready: userId === null || loaded,
      error,
      decks,
      guestDecks,
      collection,
      inventory,
      inventoryV2,
      artsAvailable,
      setArtCopies: async (cardId, artKey, quantity) => {
        const cur = inventoryRef.current[cardId] ?? EMPTY_ENTRY
        const arts = { ...cur.arts }
        const n = Math.max(0, Math.min(999, Math.floor(Number(quantity) || 0)))
        if (n === 0) delete arts[artKey]
        else arts[artKey] = n
        await setInventory(cardId, { arts })
      },
      wishlist,
      wishlistAvailable,
      setWanted,
      clearError: () => setError(null),
      createDeck: async (init = {}) => {
        const deck: Deck = { id: newId(), name: init.name ?? 'Nuevo mazo', legendIds: init.legendIds ?? [], main: init.main ?? {}, side: init.side ?? {}, updatedAt: new Date().toISOString() }
        await saveDeck(deck)
        return deck
      },
      saveDeck,
      deleteDeck: async (id) => {
        if (userId && supabase) {
          await writers.current!.deck.idle() // que no llegue un guardado pendiente DESPUÉS del borrado y lo resucite
          const { error: e } = await supabase.from('tcg_decks').delete().eq('id', id)
          if (e) return fail(e, 'No se pudo borrar el mazo.')
        }
        setDecks((prev) => {
          const next = prev.filter((d) => d.id !== id)
          if (!userId) saveLocalDecks(next)
          return next
        })
      },
      changeCopies: async (cardId, delta) => {
        const next = adjustCopies(inventoryRef.current[cardId] ?? EMPTY_ENTRY, delta)
        await setInventory(cardId, { normal: next.normal, promo: next.promo, foil: next.foil })
      },
      setInventory,
      withdrawBulk: async (items) => {
        if (!userId || !supabase || !loadedRef.current) return
        const { next, changed } = withdrawBulk(inventoryRef.current, items, (id) => playsetSize(catalog.byId[id]))
        if (changed.length === 0) return
        setInventoryState(next) // optimista: todas las filas desaparecen a la vez
        await Promise.all(
          changed.map(async (id) => {
            try {
              await writers.current!.inv.write(id, next[id] ?? { ...EMPTY_ENTRY })
            } catch (e) {
              restoreInventory(id)
              fail(e, 'No se pudo guardar la retirada del bulk.')
            }
          }),
        )
      },
      importCollection: async (counts, mode) => {
        if (!userId || !supabase || !loadedRef.current) return
        await writers.current!.inv.idle() // primero se asientan las pulsaciones pendientes
        const prev = inventoryRef.current
        const next: Inventory = mode === 'replace' ? {} : { ...prev }
        for (const [id, n] of Object.entries(counts)) {
          if (!(n > 0)) continue
          const base = mode === 'replace' ? EMPTY_ENTRY : (prev[id] ?? EMPTY_ENTRY)
          next[id] = sanitizeEntry({ ...base, normal: base.normal + n })
        }
        setInventoryState(next)
        const rows = Object.entries(next).map(([id, e]) => rowFromEntry(userId, id, e, { v2: v2Ref.current, arts: artsRef.current }))
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
        } else {
          confirmedInv.current = next
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
  }, [userId, loading, loaded, error, decks, guestDecks, collection, inventory, inventoryV2, artsAvailable, wishlist, wishlistAvailable])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData(): DataState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData fuera de DataProvider')
  return v
}

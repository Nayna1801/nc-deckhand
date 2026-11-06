import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { catalog } from '../lib/catalog'
import { copiesOfVariant, playsetSize, splitPlayset } from '../lib/inventory'
import { expandPrints, type PrintEntry } from '../lib/prints'
import { CardList, CardModal, CardRow, CardTile, PrintList, Stepper, useCardModal, usePreview, useViewMode, ViewToggle } from '../components/cardUi'
import { applyFilters, EMPTY_FILTERS, FilterBar, useSnapshot, type Filters, type OwnedFilter } from '../components/filters'
import { InventoryEditor } from '../components/InventoryEditor'
import { WishHeart } from '../components/Wish'
import { useData } from '../state/DataContext'

const OWNED_VALUES: OwnedFilter[] = ['owned', 'missing', 'wanted']
const ownedFromParam = (v: string | null): OwnedFilter => (OWNED_VALUES.includes(v as OwnedFilter) ? (v as OwnedFilter) : 'all')

export function CardsPage() {
  const { loggedIn, collection, inventory, artsAvailable, changeCopies, setArtCopies, decks, loading, ready, wishlist, wishlistAvailable } = useData()
  const [params] = useSearchParams()
  // El filtro de colección sigue a la URL: "/" = todas, "/?owned=missing" = las que me faltan.
  const urlOwned = loggedIn ? ownedFromParam(params.get('owned')) : 'all'
  const [filters, setFilters] = useState<Filters>(() => ({ ...EMPTY_FILTERS, owned: urlOwned }))
  useEffect(() => setFilters((f) => (f.owned === urlOwned ? f : { ...f, owned: urlOwned })), [urlOwned])

  const [view, setView] = useViewMode()
  // «Por impresión»: cada set y número de una carta es una ficha propia. Con un set elegido siempre se ve así,
  // porque lo que se busca son las cartas de ESE set (p. ej. los promos), no sus versiones base.
  // «Solo artes alternativos y promos» (arriba, en «Por impresión»): oculta los diseños base para ver y contar solo los distintos.
  const [byPrint, setByPrint] = useState(() => params.get('arts') === '1')
  const [onlyArts, setOnlyArts] = useState(() => params.get('arts') === '1')
  const printMode = byPrint || filters.set.length > 0
  const modal = useCardModal()
  const { bind, layer } = usePreview()

  // instantáneas: al pulsar + o ♥ la carta no salta de la lista mientras sigues editando
  const resetKey = JSON.stringify(filters) + String(loading) + String(printMode) + String(onlyArts)
  const ownedSnap = useSnapshot(collection, resetKey)
  const invSnap = useSnapshot(inventory, resetKey)
  const wantedSnap = useSnapshot(wishlist, resetKey)
  // por impresión, «las que tengo / me faltan» se decide por ficha (cada arte se cuenta aparte), no por carta
  const cards = useMemo(
    () => applyFilters(catalog.cards, filters, { owned: loggedIn && !printMode ? ownedSnap : undefined, wanted: wantedSnap }),
    [filters, ownedSnap, wantedSnap, loggedIn, printMode],
  )

  const prints = useMemo(() => {
    if (!printMode) return null
    const own = loggedIn ? filters.owned : 'all'
    return expandPrints(cards, { sets: filters.set, bySet: filters.sort === 'set' }).filter((e) => {
      if (onlyArts && e.variantKey === null) return false
      if (own !== 'owned' && own !== 'missing') return true
      const has = copiesOfVariant(invSnap[e.card.id], e.variantKey) > 0
      return own === 'owned' ? has : !has
    })
  }, [printMode, cards, filters.set, filters.sort, filters.owned, onlyArts, loggedIn, invSnap])

  const usedIn = (cardId: string) =>
    decks
      .map((d) => ({ deck: d, n: (d.main[cardId] ?? 0) + (d.side[cardId] ?? 0) + d.legendIds.filter((l) => l === cardId).length }))
      .filter((x) => x.n > 0)

  const bulkOf = (id: string) => splitPlayset(collection[id] ?? 0, playsetSize(catalog.byId[id])).bulk
  const controls = (id: string) => (
    <div className="row between tile-controls">
      {/* total de copias: + añade una Normal; − quita Normal, luego Promo, luego Foil (el detalle da control por versión) */}
      <Stepper value={collection[id] ?? 0} disabled={!ready} onChange={(v) => void changeCopies(id, v - (collection[id] ?? 0))} title="Copias totales. Con − se quitan primero las Normales; en el detalle puedes ajustar cada versión" />
      <WishHeart cardId={id} />
    </div>
  )

  // por impresión se cuentan los diseños: el arte alternativo con su propio contador y el diseño base (Beta, Retail…) junto
  const printControls = (e: PrintEntry) => {
    const id = e.card.id
    const n = copiesOfVariant(inventory[id], e.variantKey)
    const noArts = e.variantKey !== null && !artsAvailable
    return (
      <div className="row between tile-controls">
        <Stepper
          value={n}
          disabled={!ready || noArts}
          onChange={(v) => void (e.variantKey === null ? changeCopies(id, v - n) : setArtCopies(id, e.variantKey, v))}
          title={noArts ? 'Falta actualizar la base de datos (supabase/schema.sql) para contar artes alternativos' : e.variantKey === null ? 'Copias con el diseño base de la carta (Beta y Retail juntas)' : 'Copias de este arte'}
        />
        <WishHeart cardId={id} />
      </div>
    )
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Cartas</h1>
          <p className="muted">
            {prints ? `${prints.length} impresiones de ${cards.length} cartas` : `${cards.length} de ${catalog.cards.length}`}
            {!loggedIn && <> · <Link to="/login">Inicia sesión</Link> para llevar la cuenta de tus cartas</>}
          </p>
        </div>
        <div className="row wrap">
          <div className="seg" role="group" aria-label="Qué se lista">
            <button className={!printMode ? 'on' : ''} aria-pressed={!printMode} disabled={filters.set.length > 0} title={filters.set.length > 0 ? 'Con un set elegido se listan las impresiones de ese set' : 'Una ficha por carta'} onClick={() => setByPrint(false)}>Por carta</button>
            <button className={printMode ? 'on' : ''} aria-pressed={printMode} title="Una ficha por cada set y número en que se imprimió la carta" onClick={() => setByPrint(true)}>Por impresión</button>
          </div>
          {printMode && loggedIn && (
            <label className="check" title="Oculta el diseño base de cada carta: solo quedan los artes alternativos y promos con diseño propio">
              <input type="checkbox" checked={onlyArts} onChange={(e) => setOnlyArts(e.target.checked)} /> Solo artes alternativos
            </label>
          )}
          <ViewToggle value={view} onChange={setView} />
        </div>
      </header>
      <FilterBar value={filters} onChange={setFilters} showOwned={loggedIn} showWanted={loggedIn && wishlistAvailable} />

      {prints ? (
        <PrintList
          prints={prints}
          grouped={filters.sort === 'set'}
          view={view}
          renderTile={(e) => {
            const n = copiesOfVariant(inventory[e.card.id], e.variantKey)
            return (
              <CardTile
                key={e.key}
                card={e.card}
                print={e}
                preview={bind(e.card, e.image)}
                dim={loggedIn && n === 0}
                badge={loggedIn && n > 0 ? `×${n}` : undefined}
                onClick={() => modal.open(e.card.id, e.key)}
                footer={loggedIn ? printControls(e) : undefined}
              />
            )
          }}
          renderRow={(e) => {
            const n = copiesOfVariant(inventory[e.card.id], e.variantKey)
            return (
              <CardRow
                key={e.key}
                card={e.card}
                print={e}
                preview={bind(e.card, e.image)}
                dim={loggedIn && n === 0}
                badge={loggedIn && n > 0 ? `×${n}` : undefined}
                onClick={() => modal.open(e.card.id, e.key)}
                right={loggedIn ? printControls(e) : undefined}
              />
            )
          }}
        />
      ) : (
        <CardList
          cards={cards}
          grouped={filters.sort === 'set'}
          view={view}
          renderTile={(c) => {
            const n = collection[c.id] ?? 0
            const bulk = bulkOf(c.id)
            return (
              <CardTile
                key={c.id}
                card={c}
                preview={bind(c)}
                dim={loggedIn && n === 0}
                badge={loggedIn && n > 0 ? `×${n}${bulk ? ` · B${bulk}` : ''}` : undefined}
                onClick={() => modal.open(c.id)}
                footer={loggedIn ? controls(c.id) : undefined}
              />
            )
          }}
          renderRow={(c) => {
            const n = collection[c.id] ?? 0
            return (
              <CardRow
                key={c.id}
                card={c}
                preview={bind(c)}
                dim={loggedIn && n === 0}
                badge={loggedIn && n > 0 ? `×${n}` : undefined}
                onClick={() => modal.open(c.id)}
                right={loggedIn ? controls(c.id) : undefined}
              />
            )
          }}
        />
      )}
      {(prints ?? cards).length === 0 && <p className="empty">Ninguna carta coincide con los filtros.</p>}

      {layer}
      <CardModal card={modal.card} printKey={modal.printKey} onClose={modal.close}>
        {modal.card && loggedIn && (
          <>
            <InventoryEditor cardId={modal.card.id} />
            {usedIn(modal.card.id).length > 0 && (
              <div className="panel">
                <strong className="small">En tus mazos</strong>
                <ul className="plain">
                  {usedIn(modal.card.id).map(({ deck, n }) => (
                    <li key={deck.id}><Link to={`/decks/${deck.id}`}>{deck.name}</Link> <span className="muted">×{n}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardModal>
    </section>
  )
}

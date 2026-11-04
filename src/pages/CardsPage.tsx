import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { catalog } from '../lib/catalog'
import { splitPlayset } from '../lib/inventory'
import { CardList, CardModal, CardRow, CardTile, Stepper, useCardModal, usePreview, useViewMode, ViewToggle } from '../components/cardUi'
import { applyFilters, EMPTY_FILTERS, FilterBar, useSnapshot, type Filters, type OwnedFilter } from '../components/filters'
import { InventoryEditor } from '../components/InventoryEditor'
import { WishHeart } from '../components/Wish'
import { useData } from '../state/DataContext'

const OWNED_VALUES: OwnedFilter[] = ['owned', 'missing', 'wanted']
const ownedFromParam = (v: string | null): OwnedFilter => (OWNED_VALUES.includes(v as OwnedFilter) ? (v as OwnedFilter) : 'all')

export function CardsPage() {
  const { loggedIn, collection, setOwned, decks, loading, wishlist, wishlistAvailable } = useData()
  const [params] = useSearchParams()
  // El filtro de colección sigue a la URL: "/" = todas, "/?owned=missing" = las que me faltan.
  const urlOwned = loggedIn ? ownedFromParam(params.get('owned')) : 'all'
  const [filters, setFilters] = useState<Filters>(() => ({ ...EMPTY_FILTERS, owned: urlOwned }))
  useEffect(() => setFilters((f) => (f.owned === urlOwned ? f : { ...f, owned: urlOwned })), [urlOwned])

  const [view, setView] = useViewMode()
  const modal = useCardModal()
  const { bind, layer } = usePreview()

  // instantáneas: al pulsar + o ♥ la carta no salta de la lista mientras sigues editando
  const resetKey = JSON.stringify(filters) + String(loading)
  const ownedSnap = useSnapshot(collection, resetKey)
  const wantedSnap = useSnapshot(wishlist, resetKey)
  const cards = useMemo(
    () => applyFilters(catalog.cards, filters, { owned: loggedIn ? ownedSnap : undefined, wanted: wantedSnap }),
    [filters, ownedSnap, wantedSnap, loggedIn],
  )

  const usedIn = (cardId: string) =>
    decks
      .map((d) => ({ deck: d, n: (d.main[cardId] ?? 0) + (d.side[cardId] ?? 0) + d.legendIds.filter((l) => l === cardId).length }))
      .filter((x) => x.n > 0)

  const bulkOf = (id: string) => splitPlayset(collection[id] ?? 0).bulk
  const controls = (id: string) => (
    <div className="row between tile-controls">
      <Stepper value={collection[id] ?? 0} onChange={(v) => void setOwned(id, v)} />
      <WishHeart cardId={id} />
    </div>
  )

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Cartas</h1>
          <p className="muted">
            {cards.length} de {catalog.cards.length}
            {!loggedIn && <> · <Link to="/login">Inicia sesión</Link> para llevar la cuenta de tus cartas</>}
          </p>
        </div>
        <ViewToggle value={view} onChange={setView} />
      </header>
      <FilterBar value={filters} onChange={setFilters} showOwned={loggedIn} showWanted={loggedIn && wishlistAvailable} />

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
      {cards.length === 0 && <p className="empty">Ninguna carta coincide con los filtros.</p>}

      {layer}
      <CardModal card={modal.card} onClose={modal.close}>
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

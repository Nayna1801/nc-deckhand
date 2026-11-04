import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { catalog } from '../lib/catalog'
import { splitPlayset } from '../lib/inventory'
import { applyFilters, CardModal, CardRow, CardTile, EMPTY_FILTERS, FilterBar, Stepper, useCardModal, usePreview, useViewMode, ViewToggle, type Filters } from '../components/cardUi'
import { InventoryEditor } from '../components/InventoryEditor'
import { useData } from '../state/DataContext'

export function CardsPage() {
  const { loggedIn, collection, setOwned, decks } = useData()
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [view, setView] = useViewMode()
  const modal = useCardModal()
  const { bind, layer } = usePreview()
  const cards = useMemo(() => applyFilters(catalog.cards, filters, { owned: loggedIn ? collection : undefined }), [filters, collection, loggedIn])

  const usedIn = (cardId: string) =>
    decks
      .map((d) => ({ deck: d, n: (d.main[cardId] ?? 0) + (d.side[cardId] ?? 0) + d.legendIds.filter((l) => l === cardId).length }))
      .filter((x) => x.n > 0)

  const bulkOf = (id: string) => splitPlayset(collection[id] ?? 0).bulk

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
      <FilterBar value={filters} onChange={setFilters} showOwned={loggedIn} />

      {view === 'grid' ? (
        <div className="grid">
          {cards.map((c) => {
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
                footer={loggedIn ? <Stepper value={n} onChange={(v) => void setOwned(c.id, v)} /> : undefined}
              />
            )
          })}
        </div>
      ) : (
        <div className="list">
          {cards.map((c) => {
            const n = collection[c.id] ?? 0
            return (
              <CardRow
                key={c.id}
                card={c}
                preview={bind(c)}
                dim={loggedIn && n === 0}
                badge={loggedIn && n > 0 ? `×${n}` : undefined}
                onClick={() => modal.open(c.id)}
                right={loggedIn ? <Stepper value={n} onChange={(v) => void setOwned(c.id, v)} /> : undefined}
              />
            )
          })}
        </div>
      )}
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

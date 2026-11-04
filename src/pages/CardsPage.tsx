import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { catalog } from '../lib/catalog'
import { applyFilters, CardModal, CardTile, EMPTY_FILTERS, FilterBar, Stepper, useCardModal, type Filters } from '../components/cardUi'
import { useData } from '../state/DataContext'

export function CardsPage() {
  const { loggedIn, collection, setOwned, decks } = useData()
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const modal = useCardModal()
  const cards = useMemo(() => applyFilters(catalog.cards, filters, loggedIn ? collection : undefined), [filters, collection, loggedIn])

  const usedIn = (cardId: string) =>
    decks
      .map((d) => ({ deck: d, n: (d.main[cardId] ?? 0) + (d.side[cardId] ?? 0) + d.legendIds.filter((l) => l === cardId).length }))
      .filter((x) => x.n > 0)

  return (
    <section>
      <header className="page-head">
        <h1>Cartas</h1>
        <p className="muted">
          {cards.length} de {catalog.cards.length}
          {!loggedIn && <> · <Link to="/login">Inicia sesión</Link> para llevar la cuenta de tus cartas</>}
        </p>
      </header>
      <FilterBar value={filters} onChange={setFilters} showOwned={loggedIn} />
      <div className="grid">
        {cards.map((c) => {
          const n = collection[c.id] ?? 0
          return (
            <CardTile
              key={c.id}
              card={c}
              dim={loggedIn && n === 0}
              badge={loggedIn && n > 0 ? `×${n}` : undefined}
              onClick={() => modal.open(c.id)}
              footer={loggedIn ? <Stepper value={n} onChange={(v) => void setOwned(c.id, v)} /> : undefined}
            />
          )
        })}
      </div>
      {cards.length === 0 && <p className="empty">Ninguna carta coincide con los filtros.</p>}
      <CardModal card={modal.card} onClose={modal.close}>
        {modal.card && loggedIn && (
          <div className="panel">
            <div className="row between">
              <strong>Tengo</strong>
              <Stepper value={collection[modal.card.id] ?? 0} onChange={(v) => void setOwned(modal.card!.id, v)} />
            </div>
            {usedIn(modal.card.id).length > 0 && (
              <ul className="plain">
                {usedIn(modal.card.id).map(({ deck, n }) => (
                  <li key={deck.id}><Link to={`/decks/${deck.id}`}>{deck.name}</Link> <span className="muted">×{n}</span></li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardModal>
    </section>
  )
}

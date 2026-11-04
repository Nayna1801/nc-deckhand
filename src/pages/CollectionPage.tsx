import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { catalog, setLabel } from '../lib/catalog'
import { neededCards } from '../lib/deckRules'
import { parseCollectionText, serializeCollection } from '../lib/deckText'
import { CardModal, CardTile, downloadText, Stepper, useCardModal } from '../components/cardUi'
import { useData } from '../state/DataContext'

export function CollectionPage() {
  const { loggedIn, collection, decks, setOwned, replaceCollection } = useData()
  const modal = useCardModal()
  const [text, setText] = useState('')
  const [issues, setIssues] = useState<string[]>([])
  const [mode, setMode] = useState<'replace' | 'add'>('add')
  const [tab, setTab] = useState<'missing' | 'decks'>('missing')

  const stats = useMemo(() => {
    const unique = catalog.cards.filter((c) => collection[c.id] > 0)
    const total = Object.values(collection).reduce((a, b) => a + b, 0)
    const playset = catalog.cards.reduce((a, c) => a + Math.min(3, collection[c.id] ?? 0), 0)
    const bySet = [...new Set(catalog.cards.map((c) => c.setCode))].map((code) => {
      const inSet = catalog.cards.filter((c) => c.setCode === code)
      return { code, label: setLabel(inSet[0]), have: inSet.filter((c) => collection[c.id] > 0).length, of: inSet.length }
    })
    return { unique: unique.length, total, playset, bySet }
  }, [collection])

  const missingAll = useMemo(() => catalog.cards.filter((c) => !(collection[c.id] > 0)), [collection])

  // cartas que faltan para tener TODOS los mazos montados a la vez (suma de lo que pide cada mazo)
  const missingForDecks = useMemo(() => {
    const need: Record<string, number> = {}
    for (const d of decks) for (const n of neededCards(d, {})) need[n.cardId] = (need[n.cardId] ?? 0) + n.needed
    return Object.entries(need)
      .map(([id, n]) => ({ card: catalog.byId[id], needed: n, owned: collection[id] ?? 0 }))
      .filter((x) => x.card && x.needed > x.owned)
      .sort((a, b) => a.card.displayName.localeCompare(b.card.displayName))
  }, [decks, collection])

  if (!loggedIn) {
    return (
      <section>
        <header className="page-head"><h1>Colección</h1></header>
        <p className="empty">Para llevar la cuenta de tus cartas necesitas una cuenta. <Link to="/login">Iniciar sesión / crear cuenta</Link></p>
      </section>
    )
  }

  const doImport = async () => {
    const r = parseCollectionText(text, catalog)
    setIssues(r.issues.map((i) => `Línea ${i.line}: ${i.reason}`))
    if (Object.keys(r.collection).length === 0) return
    if (mode === 'replace' && !window.confirm('Esto reemplaza toda tu colección actual. ¿Continuar?')) return
    const next = mode === 'replace' ? r.collection : Object.fromEntries(Object.entries(r.collection).map(([id, n]) => [id, (collection[id] ?? 0) + n]))
    await replaceCollection(mode === 'replace' ? next : { ...collection, ...next })
    if (r.issues.length === 0) setText('')
  }

  return (
    <section>
      <header className="page-head"><h1>Colección</h1></header>

      <div className="stats-row">
        <div className="stat"><strong>{stats.unique}<small>/{catalog.cards.length}</small></strong><span>cartas distintas</span></div>
        <div className="stat"><strong>{stats.total}</strong><span>copias en total</span></div>
        <div className="stat"><strong>{Math.round((stats.playset / (catalog.cards.length * 3)) * 100)}%</strong><span>de playsets (×3)</span></div>
        {stats.bySet.map((s) => (
          <div className="stat" key={s.code}>
            <strong>{s.have}<small>/{s.of}</small></strong><span>{s.label}</span>
            <progress value={s.have} max={s.of} />
          </div>
        ))}
      </div>

      <div className="seg" role="tablist">
        <button className={tab === 'missing' ? 'on' : ''} onClick={() => setTab('missing')}>Me faltan ({missingAll.length})</button>
        <button className={tab === 'decks' ? 'on' : ''} onClick={() => setTab('decks')}>Para mis mazos ({missingForDecks.length})</button>
      </div>

      {tab === 'missing' && (
        <div className="grid compact">
          {missingAll.map((c) => (
            <CardTile key={c.id} card={c} dim onClick={() => modal.open(c.id)} footer={<Stepper value={0} onChange={(v) => void setOwned(c.id, v)} />} />
          ))}
          {missingAll.length === 0 && <p className="empty">¡Tienes todas las cartas del catálogo!</p>}
        </div>
      )}

      {tab === 'decks' && (
        <div className="panel">
          <p className="muted small">Cartas que te faltan para tener montados a la vez todos tus mazos (suma de lo que pide cada uno).</p>
          {missingForDecks.length === 0 && <p>No te falta nada para tus mazos.</p>}
          <ul className="plain">
            {missingForDecks.map(({ card, needed, owned }) => (
              <li key={card.id} className="deck-row">
                <button className="link-btn" onClick={() => modal.open(card.id)}>{card.displayName}</button>
                <span className="pill bad">faltan {needed - owned}</span>
                <span className="muted small">tienes {owned} / pides {needed}</span>
              </li>
            ))}
          </ul>
          {missingForDecks.length > 0 && (
            <button
              className="btn"
              onClick={() =>
                downloadText('faltantes.txt', missingForDecks.map((m) => `${m.needed - m.owned}x ${m.card.importId ?? ''} ${m.card.displayName}`.replace(/\s+/g, ' ')).join('\n'))
              }
            >
              Descargar lista de faltantes
            </button>
          )}
        </div>
      )}

      <h2>Importar / exportar</h2>
      <div className="panel">
        <textarea className="input mono" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'1x 012 Goro Takemura: Hands Unclean\n3x 089 Saul Bright: Stormrider'} />
        {issues.length > 0 && <ul className="errors">{issues.map((r) => <li key={r}>{r}</li>)}</ul>}
        <div className="row wrap">
          <div className="seg">
            <button className={mode === 'add' ? 'on' : ''} onClick={() => setMode('add')}>Sumar a lo que tengo</button>
            <button className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')}>Reemplazar todo</button>
          </div>
          <button className="btn primary" onClick={() => void doImport()} disabled={!text.trim()}>Importar</button>
          <button className="btn" onClick={() => downloadText('coleccion.txt', serializeCollection(collection, catalog))} disabled={stats.total === 0}>Exportar colección</button>
        </div>
      </div>

      <CardModal card={modal.card} onClose={modal.close}>
        {modal.card && (
          <div className="row between panel"><strong>Tengo</strong><Stepper value={collection[modal.card.id] ?? 0} onChange={(v) => void setOwned(modal.card!.id, v)} /></div>
        )}
      </CardModal>
    </section>
  )
}

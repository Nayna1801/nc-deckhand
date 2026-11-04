import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { catalog } from '../lib/catalog'
import { neededCards, validateDeck } from '../lib/deckRules'
import { parseDeckText } from '../lib/deckText'
import { decodeDeck } from '../lib/shareCode'
import { CardImage } from '../components/cardUi'
import { useData } from '../state/DataContext'

export function DecksPage() {
  const { decks, guestDecks, loggedIn, collection, createDeck, deleteDeck, uploadGuestDecks, loading } = useData()
  const nav = useNavigate()
  const [importing, setImporting] = useState(false)
  const [text, setText] = useState('')
  const [report, setReport] = useState<string[]>([])

  const doCreate = async () => {
    const d = await createDeck()
    if (d) nav(`/decks/${d.id}`)
  }

  const doImport = async () => {
    if (/ncd1\./.test(text)) {
      const r = await decodeDeck(text, catalog)
      if (!r.ok) return setReport([r.error])
      const d = await createDeck({ name: r.deck.name, legendIds: r.deck.legendIds, main: r.deck.main, side: r.deck.side })
      if (d) nav(`/decks/${d.id}`)
      return
    }
    const parsed = parseDeckText(text, catalog)
    const nothing = parsed.legendIds.length === 0 && Object.keys(parsed.main).length === 0 && Object.keys(parsed.side).length === 0
    if (nothing) {
      setReport(['No se ha reconocido ninguna carta.', ...parsed.issues.map((i) => `Línea ${i.line}: ${i.reason}`)])
      return
    }
    const d = await createDeck({ name: parsed.name, legendIds: parsed.legendIds.slice(0, 3), main: parsed.main, side: parsed.side })
    if (d) nav(`/decks/${d.id}`)
  }

  return (
    <section>
      <header className="page-head">
        <h1>Mazos</h1>
        <div className="row">
          <button className="btn" onClick={() => setImporting((v) => !v)}>Importar texto</button>
          <button className="btn primary" onClick={() => void doCreate()}>Nuevo mazo</button>
        </div>
      </header>

      {!loggedIn && (
        <p className="notice">
          Estás como invitado: tus mazos se guardan solo en este navegador. <Link to="/login">Inicia sesión</Link> para guardarlos en tu cuenta y ver qué cartas te faltan.
        </p>
      )}
      {loggedIn && guestDecks.length > 0 && (
        <p className="notice">
          Tienes {guestDecks.length} mazo(s) creados como invitado en este navegador.{' '}
          <button className="btn sm" onClick={() => void uploadGuestDecks()}>Subir a mi cuenta</button>
        </p>
      )}

      {importing && (
        <div className="panel">
          <p className="muted small">Pega aquí un mazo exportado desde cyberpunk-tcg-sim.online (o cualquier web con el mismo formato), o un código/enlace de mazo compartido desde esta web.</p>
          <textarea className="input mono" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'# Name: Mi mazo\n\n# Legends\n1x 012 Goro Takemura: Hands Unclean\n\n# Main Deck\n1x 089 Saul Bright: Stormrider'} />
          {report.length > 0 && <ul className="errors">{report.map((r) => <li key={r}>{r}</li>)}</ul>}
          <div className="row"><button className="btn primary" onClick={() => void doImport()} disabled={!text.trim()}>Crear mazo</button></div>
        </div>
      )}

      {loading && <p className="muted">Cargando…</p>}
      {decks.length === 0 && !loading && <p className="empty">Aún no tienes mazos. Crea uno nuevo o importa uno desde texto.</p>}

      <div className="deck-list">
        {decks.map((d) => {
          const r = validateDeck(d, catalog)
          const missing = loggedIn ? neededCards(d, collection).reduce((a, n) => a + n.missing, 0) : null
          return (
            <article key={d.id} className="deck-card">
              <Link to={`/decks/${d.id}`} className="deck-legends" aria-label={`Abrir ${d.name}`}>
                {d.legendIds.length === 0 && <span className="muted">Sin Legends</span>}
                {d.legendIds.map((id) => catalog.byId[id] && <CardImage key={id} card={catalog.byId[id]} />)}
              </Link>
              <div className="deck-meta">
                <Link to={`/decks/${d.id}`}><h3>{d.name}</h3></Link>
                <p className="muted small">{r.mainCount} cartas · {r.sideCount} sideboard · {d.legendIds.length}/3 Legends</p>
                <p className="row small">
                  <span className={`pill ${r.errors.length ? 'bad' : r.isValid ? 'ok' : 'warn'}`}>{r.errors.length ? 'Ilegal' : r.isValid ? 'Legal' : 'Incompleto'}</span>
                  {missing != null && <span className={`pill ${missing ? 'bad' : 'ok'}`}>{missing ? `Faltan ${missing}` : 'Lo tienes todo'}</span>}
                </p>
                <button className="btn ghost sm" onClick={() => window.confirm(`¿Borrar "${d.name}"?`) && void deleteDeck(d.id)}>Borrar</button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

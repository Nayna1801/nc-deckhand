import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { catalog } from '../lib/catalog'
import { neededCards, validateDeck } from '../lib/deckRules'
import { MAX_IMPORT_CHARS, parseDeckText, serializeDeck, serializeDeckMelee } from '../lib/deckText'
import { decodeDeck } from '../lib/shareCode'
import type { Deck } from '../lib/types'
import { CardImage, downloadText } from '../components/cardUi'
import { ColorCode } from '../components/ColorCode'
import { useConfirm } from '../components/Confirm'
import { useData } from '../state/DataContext'

function DeckCard({ deck }: { deck: Deck }) {
  const { collection, loggedIn, deleteDeck } = useData()
  const confirm = useConfirm()
  const [msg, setMsg] = useState('')
  const r = validateDeck(deck, catalog)
  const missing = loggedIn ? neededCards(deck, collection).reduce((a, n) => a + n.missing, 0) : null
  const text = serializeDeck(deck, catalog)

  const flash = (m: string) => {
    setMsg(m)
    window.setTimeout(() => setMsg(''), 2200)
  }
  const copy = async (value = text, done = 'Lista copiada ✓') => {
    try {
      await navigator.clipboard.writeText(value)
      flash(done)
    } catch {
      flash('No se pudo copiar')
    }
  }

  return (
    <article className="deck-card">
      <Link to={`/decks/${deck.id}`} className="deck-legends3" aria-label={`Abrir ${deck.name}`}>
        {[0, 1, 2].map((i) => {
          const c = catalog.byId[deck.legendIds[i]]
          return c ? <CardImage key={c.id} card={c} /> : <span key={`e${i}`} className="legend-empty">Legend {i + 1}</span>
        })}
      </Link>

      <div className="deck-body">
        <Link to={`/decks/${deck.id}`} className="deck-title"><h3>{deck.name}</h3></Link>
        <ColorCode legendIds={deck.legendIds} />
        <p className="deck-counts muted small">{r.mainCount} cartas · {r.sideCount} sideboard · {r.legendCount}/3 Legends</p>
        <div className="deck-pills">
          <span className={`pill ${r.errors.length ? 'bad' : r.isValid ? 'ok' : 'warn'}`}>{r.errors.length ? 'Ilegal' : r.isValid ? 'Legal' : 'Incompleto'}</span>
          {missing != null && <span className={`pill ${missing ? 'bad' : 'ok'}`}>{missing ? `Faltan ${missing}` : 'Lo tienes todo'}</span>}
        </div>
        <div className="deck-actions">
          <button className="btn sm" onClick={() => void copy()}>Copiar lista</button>
          <button className="btn sm" onClick={() => downloadText(`${deck.name.replace(/[^\w-]+/g, '_')}.txt`, text)}>Exportar .txt</button>
          <button className="btn sm" onClick={() => void copy(serializeDeckMelee(deck, catalog), 'Lista melee.gg copiada ✓')}>Copiar para melee.gg</button>
          <button className="btn ghost sm" onClick={async () => {
            if (await confirm({ title: 'Borrar mazo', message: `¿Borrar "${deck.name}"? No se puede deshacer.`, confirmLabel: 'Borrar', danger: true })) await deleteDeck(deck.id)
          }}>Borrar</button>
        </div>
        <p className="deck-msg small" role="status" aria-live="polite">{msg}</p>
      </div>
    </article>
  )
}

export function DecksPage() {
  const { decks, guestDecks, loggedIn, createDeck, uploadGuestDecks, loading } = useData()
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
      setReport(['No se ha reconocido ninguna carta.', ...parsed.issues.map((i) => (i.line ? `Línea ${i.line}: ${i.reason}` : i.reason))])
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
          <textarea className="input mono" rows={10} maxLength={MAX_IMPORT_CHARS} value={text} onChange={(e) => setText(e.target.value)} placeholder={'# Name: Mi mazo\n\n# Legends\n1x 012 Goro Takemura: Hands Unclean\n\n# Main Deck\n1x 089 Saul Bright: Stormrider'} />
          {report.length > 0 && <ul className="errors">{report.map((r) => <li key={r}>{r}</li>)}</ul>}
          <div className="row"><button className="btn primary" onClick={() => void doImport()} disabled={!text.trim()}>Crear mazo</button></div>
        </div>
      )}

      {loading && <p className="muted">Cargando…</p>}
      {decks.length === 0 && !loading && <p className="empty">Aún no tienes mazos. Crea uno nuevo o importa uno desde texto.</p>}

      <div className="deck-list">
        {decks.map((d) => <DeckCard key={d.id} deck={d} />)}
      </div>
    </section>
  )
}

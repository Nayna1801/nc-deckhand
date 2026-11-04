import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { catalog } from '../lib/catalog'
import { validateDeck } from '../lib/deckRules'
import { decodeDeck, type DecodeResult } from '../lib/shareCode'
import { CardImage } from '../components/cardUi'
import { useData } from '../state/DataContext'

/** Abre un mazo compartido por código/enlace y permite guardarlo como copia propia. */
export function SharePage() {
  const { code = '' } = useParams()
  const nav = useNavigate()
  const { createDeck } = useData()
  const [result, setResult] = useState<DecodeResult | null>(null)

  useEffect(() => {
    let active = true
    void decodeDeck(code, catalog).then((r) => active && setResult(r))
    return () => {
      active = false
    }
  }, [code])

  if (!result) return <p className="muted">Leyendo el código…</p>
  if (!result.ok) {
    return (
      <section className="auth">
        <h1>Código no válido</h1>
        <p className="errors">{result.error}</p>
        <Link to="/decks">Ir a mis mazos</Link>
      </section>
    )
  }

  const { deck } = result
  const report = validateDeck(deck, catalog)
  const save = async () => {
    const d = await createDeck(deck)
    if (d) nav(`/decks/${d.id}`, { replace: true })
  }

  return (
    <section className="auth wide">
      <h1>{deck.name}</h1>
      <p className="muted">Mazo compartido · {report.mainCount} cartas · {report.sideCount} sideboard</p>
      <div className="deck-legends big">{deck.legendIds.map((id) => catalog.byId[id] && <CardImage key={id} card={catalog.byId[id]} />)}</div>
      <p className="row"><span className={`pill ${report.errors.length ? 'bad' : report.isValid ? 'ok' : 'warn'}`}>{report.errors.length ? 'Ilegal' : report.isValid ? 'Legal' : 'Borrador'}</span></p>
      {report.errors.length > 0 && <ul className="errors">{report.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <button className="btn primary" onClick={() => void save()}>Guardar una copia en mis mazos</button>
    </section>
  )
}

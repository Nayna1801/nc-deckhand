import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { catalog } from '../lib/catalog'
import { neededCards, RULES, validateDeck } from '../lib/deckRules'
import { parseDeckText, serializeDeck } from '../lib/deckText'
import type { Card, Deck, Quantities } from '../lib/types'
import { applyFilters, CardModal, CardTile, ColorDot, downloadText, EMPTY_FILTERS, FilterBar, Stepper, useCardModal, type Filters } from '../components/cardUi'
import { useData } from '../state/DataContext'

const TYPE_ORDER: Record<string, number> = { Unit: 0, Gear: 1, Program: 2, Legend: 3 }
const byOrder = (a: Card, b: Card) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || (a.cost ?? 0) - (b.cost ?? 0) || a.displayName.localeCompare(b.displayName)

function bump(q: Quantities, id: string, delta: number): Quantities {
  const next = { ...q }
  const n = (next[id] ?? 0) + delta
  if (n <= 0) delete next[id]
  else next[id] = n
  return next
}

export function DeckEditorPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { decks, saveDeck, deleteDeck, collection, loggedIn, loading } = useData()
  const stored = decks.find((d) => d.id === id)
  const [deck, setDeck] = useState<Deck | null>(stored ?? null)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [target, setTarget] = useState<'main' | 'side'>('main')
  const [panel, setPanel] = useState<'none' | 'export' | 'import'>('none')
  const [importText, setImportText] = useState('')
  const [importReport, setImportReport] = useState<string[]>([])
  const [copied, setCopied] = useState('')
  const modal = useCardModal()
  const dirty = useRef(false)

  // si los datos llegan después (carga de cuenta), enganchamos el mazo
  useEffect(() => {
    if (!deck && stored) setDeck(stored)
  }, [stored, deck])

  // autoguardado con debounce
  useEffect(() => {
    if (!deck || !dirty.current) return
    const t = setTimeout(() => {
      dirty.current = false
      void saveDeck(deck)
    }, 600)
    return () => clearTimeout(t)
  }, [deck, saveDeck])

  const edit = (fn: (d: Deck) => Deck) => {
    dirty.current = true
    setDeck((d) => (d ? fn(d) : d))
  }

  const report = useMemo(() => (deck ? validateDeck(deck, catalog) : null), [deck])
  const needs = useMemo(() => (deck ? neededCards(deck, collection) : []), [deck, collection])
  const missingTotal = needs.reduce((a, n) => a + n.missing, 0)
  const cards = useMemo(() => applyFilters(catalog.cards, filters, loggedIn ? collection : undefined), [filters, collection, loggedIn])

  if (!deck || !report) {
    return loading ? <p className="muted">Cargando…</p> : (
      <p className="empty">No se encuentra este mazo. <Link to="/decks">Volver a mis mazos</Link></p>
    )
  }

  const inDeck = (cardId: string) => (deck.main[cardId] ?? 0) + (deck.side[cardId] ?? 0)
  const ownedOf = (cardId: string) => collection[cardId] ?? 0

  const add = (card: Card) => {
    if (card.type === 'Legend') {
      if (deck.legendIds.includes(card.id) || deck.legendIds.length >= RULES.legends) return
      edit((d) => ({ ...d, legendIds: [...d.legendIds, card.id] }))
      return
    }
    edit((d) => ({ ...d, [target]: bump(d[target], card.id, 1) }))
  }

  const mainRows = Object.keys(deck.main).map((k) => catalog.byId[k]).filter(Boolean).sort(byOrder)
  const sideRows = Object.keys(deck.side).map((k) => catalog.byId[k]).filter(Boolean).sort(byOrder)
  const exportText = serializeDeck(deck, catalog)

  const doImport = () => {
    const p = parseDeckText(importText, catalog, deck.name)
    const lines = [...p.issues.map((i) => `Línea ${i.line}: ${i.reason}`), ...p.warnings]
    setImportReport(lines)
    if (p.legendIds.length === 0 && !Object.keys(p.main).length && !Object.keys(p.side).length) return
    edit((d) => ({ ...d, name: p.name, legendIds: [...new Set(p.legendIds)].slice(0, RULES.legends), main: p.main, side: p.side }))
    if (p.issues.length === 0) {
      setPanel('none')
      setImportText('')
    }
  }

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      setCopied('No se pudo copiar')
    }
  }

  const missingText = needs
    .filter((n) => n.missing > 0)
    .map((n) => `${n.missing}x ${catalog.byId[n.cardId]?.importId ?? ''} ${catalog.byId[n.cardId]?.displayName ?? n.cardId}`.replace(/\s+/g, ' '))
    .join('\n')

  const row = (card: Card, q: Quantities, key: 'main' | 'side') => {
    const have = ownedOf(card.id)
    const need = inDeck(card.id)
    const short = loggedIn && need > have
    return (
      <li key={`${key}-${card.id}`} className={`deck-row ${short ? 'short' : ''}`}>
        <button className="link-btn" onClick={() => modal.open(card.id)}>
          <ColorDot color={card.color} /> <span className="cost">{card.cost ?? '–'}</span> {card.displayName}
        </button>
        {short && <span className="pill bad" title={`Tienes ${have}, necesitas ${need}`}>tienes {have}</span>}
        <Stepper value={q[card.id]} onChange={(v) => edit((d) => ({ ...d, [key]: bump(d[key], card.id, v - q[card.id]) }))} />
      </li>
    )
  }

  return (
    <section className="editor">
      <div className="editor-cards">
        <header className="page-head">
          <h1>Cartas</h1>
          <div className="seg" role="group" aria-label="Destino al pulsar una carta">
            <button className={target === 'main' ? 'on' : ''} onClick={() => setTarget('main')}>Añadir al mazo</button>
            <button className={target === 'side' ? 'on' : ''} onClick={() => setTarget('side')}>Añadir al sideboard</button>
          </div>
        </header>
        <FilterBar value={filters} onChange={setFilters} showOwned={loggedIn} />
        <div className="grid compact">
          {cards.map((c) => {
            const isLegend = c.type === 'Legend'
            const used = isLegend ? (deck.legendIds.includes(c.id) ? 1 : 0) : inDeck(c.id)
            return (
              <CardTile
                key={c.id}
                card={c}
                dim={loggedIn && ownedOf(c.id) === 0}
                badge={used > 0 ? `${used}` : undefined}
                onClick={() => add(c)}
                footer={
                  <div className="row between small">
                    {loggedIn ? <span className={ownedOf(c.id) ? '' : 'muted'}>Tengo {ownedOf(c.id)}</span> : <span />}
                    <button className="link-btn" onClick={() => modal.open(c.id)}>Detalle</button>
                  </div>
                }
              />
            )
          })}
        </div>
      </div>

      <aside className="editor-deck">
        <input className="input title-input" value={deck.name} maxLength={64} onChange={(e) => edit((d) => ({ ...d, name: e.target.value || 'Sin nombre' }))} aria-label="Nombre del mazo" />

        <div className="counters">
          <span className={report.legendCount === RULES.legends ? 'ok' : ''}>Legends {report.legendCount}/{RULES.legends}</span>
          <span className={report.mainCount >= RULES.minMain && report.mainCount <= RULES.maxMain ? 'ok' : ''}>Mazo {report.mainCount} ({RULES.minMain}–{RULES.maxMain})</span>
          <span className={report.sideCount <= RULES.maxSide ? '' : 'bad'}>Side {report.sideCount}/{RULES.maxSide}</span>
          <span className="ram">RAM {Object.entries(report.ram).map(([c, n]) => <span key={c}><ColorDot color={c} />{n}</span>)}</span>
        </div>

        {report.errors.length > 0 && <ul className="errors">{report.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        {report.errors.length === 0 && report.incomplete.length > 0 && <ul className="warns">{report.incomplete.map((e) => <li key={e}>{e}</li>)}</ul>}
        {report.isValid && <p className="pill ok">Mazo legal en Standard</p>}
        {loggedIn && (
          <p className={`pill ${missingTotal ? 'bad' : 'ok'}`}>{missingTotal ? `Te faltan ${missingTotal} carta(s) para montarlo` : 'Tienes todas las cartas de este mazo'}</p>
        )}

        <h3>Legends</h3>
        <ul className="plain">
          {deck.legendIds.map((lid) => {
            const c = catalog.byId[lid]
            if (!c) return null
            const short = loggedIn && ownedOf(lid) < 1
            return (
              <li key={lid} className={`deck-row ${short ? 'short' : ''}`}>
                <button className="link-btn" onClick={() => modal.open(lid)}><ColorDot color={c.color} /> {c.displayName}</button>
                {short && <span className="pill bad">no la tienes</span>}
                <button className="btn sm" onClick={() => edit((d) => ({ ...d, legendIds: d.legendIds.filter((x) => x !== lid) }))} aria-label="Quitar Legend">✕</button>
              </li>
            )
          })}
          {deck.legendIds.length === 0 && <li className="muted small">Pulsa una carta tipo Legend para elegirla.</li>}
        </ul>

        <h3>Mazo principal</h3>
        <ul className="plain">{mainRows.map((c) => row(c, deck.main, 'main'))}</ul>
        {mainRows.length === 0 && <p className="muted small">Pulsa una carta para añadirla.</p>}

        {sideRows.length > 0 && (<><h3>Sideboard</h3><ul className="plain">{sideRows.map((c) => row(c, deck.side, 'side'))}</ul></>)}

        <div className="row wrap actions">
          <button className="btn" onClick={() => setPanel(panel === 'export' ? 'none' : 'export')}>Exportar</button>
          <button className="btn" onClick={() => setPanel(panel === 'import' ? 'none' : 'import')}>Importar</button>
          {loggedIn && missingText && <button className="btn" onClick={() => void copy('Faltantes copiados', missingText)}>Copiar faltantes</button>}
          <button className="btn ghost" onClick={() => window.confirm(`¿Borrar "${deck.name}"?`) && void deleteDeck(deck.id).then(() => nav('/decks'))}>Borrar</button>
          {copied && <span className="muted small">{copied}</span>}
        </div>

        {panel === 'export' && (
          <div className="panel">
            <textarea className="input mono" rows={12} readOnly value={exportText} onFocus={(e) => e.currentTarget.select()} />
            <div className="row">
              <button className="btn primary" onClick={() => void copy('Copiado', exportText)}>Copiar</button>
              <button className="btn" onClick={() => downloadText(`${deck.name.replace(/[^\w-]+/g, '_')}.txt`, exportText)}>Descargar .txt</button>
            </div>
          </div>
        )}
        {panel === 'import' && (
          <div className="panel">
            <p className="muted small">Reemplaza el contenido de este mazo.</p>
            <textarea className="input mono" rows={10} value={importText} onChange={(e) => setImportText(e.target.value)} />
            {importReport.length > 0 && <ul className="errors">{importReport.map((r) => <li key={r}>{r}</li>)}</ul>}
            <button className="btn primary" onClick={doImport} disabled={!importText.trim()}>Importar</button>
          </div>
        )}
      </aside>

      <CardModal card={modal.card} onClose={modal.close}>
        {modal.card && (
          <div className="row">
            <button className="btn primary" onClick={() => add(modal.card!)}>Añadir al {modal.card.type === 'Legend' ? 'mazo (Legend)' : target === 'main' ? 'mazo' : 'sideboard'}</button>
            {loggedIn && <span className="muted">Tengo {ownedOf(modal.card.id)}</span>}
          </div>
        )}
      </CardModal>
    </section>
  )
}

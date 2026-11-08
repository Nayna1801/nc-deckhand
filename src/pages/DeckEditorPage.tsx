import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { catalog, normalizeText } from '../lib/catalog'
import { costCurve, typeRatio } from '../lib/analytics'
import { canAddCopy, exceedsRam, neededCards, RULES, validateDeck } from '../lib/deckRules'
import { parseDeckText, serializeDeck, MAX_IMPORT_CHARS } from '../lib/deckText'
import { groupDeckCards } from '../lib/deckView'
import { encodeDeck } from '../lib/shareCode'
import type { Card, Deck, Quantities } from '../lib/types'
import { CardImage, CardList, CardModal, CardRow, CardTile, ColorDot, downloadText, Stepper, useCardModal, usePreview, useViewMode, ViewToggle } from '../components/cardUi'
import { applyFilters, EMPTY_FILTERS, FilterBar, useSnapshot, type Filters } from '../components/filters'
import { ColorCode } from '../components/ColorCode'
import { CameraIcon } from '../components/Icons'
import { Scanner, type ScanChoice } from '../components/Scanner'
import { CostCurveChart, TypeDonut } from '../components/Charts'
import { InventoryEditor } from '../components/InventoryEditor'
import { useData } from '../state/DataContext'

type Zone = 'main' | 'side' | 'legend'

function bump(q: Quantities, id: string, delta: number): Quantities {
  const next = { ...q }
  const n = (next[id] ?? 0) + delta
  if (n <= 0) delete next[id]
  else next[id] = n
  return next
}

function without(q: Quantities, id: string): Quantities {
  const next = { ...q }
  delete next[id]
  return next
}

export function DeckEditorPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { decks, saveDeck, deleteDeck, collection, loggedIn, loading } = useData()
  const stored = decks.find((d) => d.id === id)
  const [deck, setDeck] = useState<Deck | null>(stored ?? null)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [view, setView] = useViewMode()
  const [target, setTarget] = useState<'main' | 'side'>('main')
  const [pane, setPane] = useState<'cards' | 'deck'>('cards')
  const [panel, setPanel] = useState<'none' | 'export' | 'import'>('none')
  const [importText, setImportText] = useState('')
  const [importReport, setImportReport] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [scanning, setScanning] = useState(false)
  const [shareCode, setShareCode] = useState('')
  const [dropZone, setDropZone] = useState<string | null>(null)
  const modal = useCardModal()
  const { bind, layer } = usePreview()
  const dirty = useRef(false)

  useEffect(() => {
    if (!deck && stored) setDeck(stored)
  }, [stored, deck])

  // autoguardado de borradores con debounce
  useEffect(() => {
    if (!deck || !dirty.current) return
    const t = setTimeout(() => {
      dirty.current = false
      void saveDeck(deck)
    }, 600)
    return () => clearTimeout(t)
  }, [deck, saveDeck])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 3200)
    return () => clearTimeout(t)
  }, [notice])

  useEffect(() => {
    if (panel !== 'export' || !deck) return
    let active = true
    void encodeDeck(deck).then((c) => active && setShareCode(c))
    return () => {
      active = false
    }
  }, [panel, deck])

  const edit = (fn: (d: Deck) => Deck) => {
    dirty.current = true
    setDeck((d) => (d ? fn(d) : d))
  }

  const report = useMemo(() => (deck ? validateDeck(deck, catalog) : null), [deck])
  const needs = useMemo(() => (deck ? neededCards(deck, collection) : []), [deck, collection])
  const curve = useMemo(() => (deck ? costCurve(deck, catalog) : []), [deck])
  const ratio = useMemo(() => (deck ? typeRatio(deck, catalog) : []), [deck])
  const missingTotal = needs.reduce((a, n) => a + n.missing, 0)
  const ownedSnap = useSnapshot(collection, JSON.stringify(filters) + String(loading))
  const cards = useMemo(
    () => applyFilters(catalog.cards, filters, { owned: loggedIn ? ownedSnap : undefined, legendIds: deck?.legendIds }),
    [filters, ownedSnap, loggedIn, deck?.legendIds],
  )

  if (!deck || !report) {
    return loading ? <p className="muted">Cargando…</p> : <p className="empty">No se encuentra este mazo. <Link to="/decks">Volver a mis mazos</Link></p>
  }

  const inDeck = (cardId: string) => (deck.main[cardId] ?? 0) + (deck.side[cardId] ?? 0)
  const ownedOf = (cardId: string) => collection[cardId] ?? 0

  /** Por qué no se puede añadir esta carta ahora mismo ('' = se puede). */
  const blockReason = (card: Card): string => {
    if (card.type === 'Legend') {
      if (deck.legendIds.includes(card.id)) return 'Esta Legend ya está en el mazo'
      if (deck.legendIds.some((l) => normalizeText(catalog.byId[l]?.name ?? '') === normalizeText(card.name))) return `Ya tienes una Legend de ${card.name}`
      if (deck.legendIds.length >= RULES.legends) return `Ya tienes ${RULES.legends} Legends`
      return ''
    }
    return canAddCopy(deck, card, catalog) ? '' : `Máximo ${RULES.maxCopies} copias`
  }
  const ramReason = (card: Card): string =>
    exceedsRam(card, deck.legendIds, catalog) ? `Necesita ${card.ram} de RAM ${card.color}; tus Legends dan ${report.ram[card.color ?? ''] ?? 0}` : ''
  const ramShort = (card: Card): string => (ramReason(card) ? `RAM ${card.color} ${card.ram} > ${report.ram[card.color ?? ''] ?? 0}` : '')

  const add = (card: Card, zone?: Zone) => {
    const why = blockReason(card)
    if (why) return setNotice(why)
    if (card.type === 'Legend') return edit((d) => ({ ...d, legendIds: [...d.legendIds, card.id] }))
    const z = zone === 'side' || zone === 'main' ? zone : target
    edit((d) => ({ ...d, [z]: bump(d[z], card.id, 1) }))
  }

  /* ---------- arrastrar y soltar ---------- */
  const zoneProps = (zone: Zone | 'catalog') => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault()
      setDropZone(zone)
    },
    onDragLeave: () => setDropZone((z) => (z === zone ? null : z)),
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      setDropZone(null)
      handleDrop(e.dataTransfer.getData('text/plain'), zone)
    },
  })

  const handleDrop = (payload: string, zone: Zone | 'catalog') => {
    const [kind, a, b] = payload.split(':')
    if (kind === 'card') {
      const card = catalog.byId[a]
      if (card && zone !== 'catalog') add(card, zone)
      return
    }
    if (kind !== 'deck') return
    const from = a as Zone
    const card = catalog.byId[b]
    if (!card) return
    if (zone === 'catalog') {
      // arrastrar fuera del mazo = quitar la carta de esa zona
      edit((d) => (from === 'legend' ? { ...d, legendIds: d.legendIds.filter((x) => x !== b) } : { ...d, [from]: without(d[from], b) }))
    } else if ((from === 'main' || from === 'side') && (zone === 'main' || zone === 'side') && from !== zone) {
      edit((d) => ({ ...d, [from]: bump(d[from], b, -1), [zone]: bump(d[zone], b, 1) }))
    }
  }

  const mainRows = Object.keys(deck.main).map((k) => catalog.byId[k]).filter(Boolean)
  const sideRows = Object.keys(deck.side).map((k) => catalog.byId[k]).filter(Boolean)
  const exportText = serializeDeck(deck, catalog)
  const shareLink = shareCode ? `${location.origin}${location.pathname}#/share/${shareCode}` : ''

  const doImport = () => {
    const p = parseDeckText(importText, catalog, deck.name)
    setImportReport([...p.issues.map((i) => (i.line ? `Línea ${i.line}: ${i.reason}` : i.reason)), ...p.warnings])
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
      setNotice(label)
    } catch {
      setNotice('No se pudo copiar al portapapeles')
    }
  }

  const missingText = needs
    .filter((n) => n.missing > 0)
    .map((n) => `${n.missing}x ${catalog.byId[n.cardId]?.importId ?? ''} ${catalog.byId[n.cardId]?.displayName ?? n.cardId}`.replace(/\s+/g, ' '))
    .join('\n')

  const deckRow = (card: Card, q: Quantities, zone: 'main' | 'side') => {
    const need = inDeck(card.id)
    const short = loggedIn && need > ownedOf(card.id)
    const ram = ramReason(card)
    return (
      <li key={`${zone}-${card.id}`} className={`deck-row dk-row ${short ? 'short' : ''}`} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', `deck:${zone}:${card.id}`); e.dataTransfer.effectAllowed = 'move' }}>
        <button type="button" className="dk-thumb" tabIndex={-1} aria-hidden="true" onClick={() => modal.open(card.id)} {...bind(card)}>
          <CardImage card={card} thumb />
        </button>
        <div className="dk-main">
          <button className="link-btn dk-name" onClick={() => modal.open(card.id)} {...bind(card)}>
            {ram && <span title={ram} aria-label="Supera la RAM">🔒 </span>}
            <ColorDot color={card.color} /> <span className="cost">{card.cost ?? '–'}</span> {card.displayName}
          </button>
          {short && <span className="pill bad" title={`Tienes ${ownedOf(card.id)}, necesitas ${need}`}>tienes {ownedOf(card.id)}</span>}
        </div>
        <Stepper value={q[card.id]} disableAdd={!!blockReason(card)} addTitle={blockReason(card)} onChange={(v) => edit((d) => ({ ...d, [zone]: bump(d[zone], card.id, v - q[card.id]) }))} />
      </li>
    )
  }

  /** Cartas de una zona del mazo, separadas por tipo (Unidades, Gear, Programas) y ordenadas por color e Id. */
  const zoneRows = (rows: Card[], q: Quantities, zone: 'main' | 'side') =>
    groupDeckCards(rows, q).flatMap((g) => [
      <li key={`${zone}-head-${g.type}`} className="dk-group" aria-label={`${g.label}: ${g.copies}`}>
        <span>{g.label}</span>
        <small>{g.copies}</small>
      </li>,
      ...g.cards.map((c) => deckRow(c, q, zone)),
    ])

  /** Carta confirmada en el escáner: se añade al mazo (o al sideboard) con las mismas reglas que el botón +. */
  const addScanned = (c: ScanChoice) => {
    const card = catalog.byId[c.cardId]
    if (!card) return
    const why = blockReason(card)
    if (why) return setNotice(`${card.displayName}: ${why}`)
    add(card)
    setNotice(`Añadida: ${card.displayName}`)
  }

  /** Quita una copia de la carta: de la zona elegida si está allí y, si no, de la otra (las Legends, de sus ranuras). */
  const removeOne = (card: Card) => {
    if (card.type === 'Legend') return edit((d) => ({ ...d, legendIds: d.legendIds.filter((x) => x !== card.id) }))
    const zone: 'main' | 'side' = (deck[target][card.id] ?? 0) > 0 ? target : target === 'main' ? 'side' : 'main'
    edit((d) => ({ ...d, [zone]: bump(d[zone], card.id, -1) }))
  }

  const usedCount = (c: Card) => (c.type === 'Legend' ? (deck.legendIds.includes(c.id) ? 1 : 0) : inDeck(c.id))

  /** Quitar y añadir una copia; en medio, cuántas lleva el mazo. */
  const addButton = (card: Card): ReactNode => {
    const why = blockReason(card)
    const used = usedCount(card)
    return (
      <div className="stepper dk-qty">
        <button className="btn sm" disabled={used === 0} title="Quitar una copia del mazo" onClick={() => removeOne(card)} aria-label={`Quitar ${card.displayName}`}>−</button>
        <span className="stepper-n" aria-label={`En el mazo: ${used}`}>{used}</span>
        <button className="btn sm" disabled={!!why} title={why || `Añadir ${card.type === 'Legend' ? 'como Legend' : target === 'main' ? 'al mazo' : 'al sideboard'}`} onClick={() => add(card)} aria-label={`Añadir ${card.displayName}`}>+</button>
      </div>
    )
  }

  const usedBadge = (c: Card) => {
    const used = c.type === 'Legend' ? (deck.legendIds.includes(c.id) ? 1 : 0) : inDeck(c.id)
    return used > 0 ? `${used}` : undefined
  }

  const legendSlots = Array.from({ length: RULES.legends }, (_, i) => catalog.byId[deck.legendIds[i]] ?? null)

  return (
    <>
      <div className="pane-switch seg" role="tablist" aria-label="Vista del constructor">
        <button role="tab" aria-selected={pane === 'cards'} className={pane === 'cards' ? 'on' : ''} onClick={() => setPane('cards')}>Catálogo</button>
        <button role="tab" aria-selected={pane === 'deck'} className={pane === 'deck' ? 'on' : ''} onClick={() => setPane('deck')}>
          Mazo {report.mainCount}/{RULES.minMain} · {report.legendCount}/{RULES.legends}L
        </button>
      </div>

      <section className="editor" data-pane={pane}>
        <div className={`editor-cards ${dropZone === 'catalog' ? 'drop-remove' : ''}`} {...zoneProps('catalog')}>
          <header className="page-head">
            <h1>Cartas</h1>
            <div className="row wrap">
              <button type="button" className={`btn scan-cta ${scanning ? 'on' : ''}`} aria-pressed={scanning} onClick={() => setScanning((v) => !v)} title="Reconoce cartas con la cámara y añádelas al mazo"><CameraIcon /><span>Escanear</span></button>
              <ViewToggle value={view} onChange={setView} />
              <div className="seg" role="group" aria-label="Destino al pulsar una carta">
                <button className={target === 'main' ? 'on' : ''} onClick={() => setTarget('main')}>Al mazo</button>
                <button className={target === 'side' ? 'on' : ''} onClick={() => setTarget('side')}>Al sideboard</button>
              </div>
            </div>
          </header>
          {scanning && (
            <div className="panel scan-embed">
              <div className="row between wrap">
                <strong>Escanear cartas para el mazo</strong>
                <button type="button" className="btn sm" onClick={() => setScanning(false)}>Cerrar escáner</button>
              </div>
              <p className="muted small">Cada carta que confirmes va {target === 'main' ? 'al mazo' : 'al sideboard'} (puedes cambiarlo arriba). Mazo: {report.mainCount}/{RULES.minMain} · Side {report.sideCount}/{RULES.maxSide} · Legends {report.legendCount}/{RULES.legends}.</p>
              <Scanner onChoose={addScanned} chooseLabel="Añadir al mazo" />
            </div>
          )}
          <FilterBar value={filters} onChange={setFilters} showOwned={loggedIn} showRam />
          {deck.legendIds.length > 0 && <p className="muted small">🔒 = supera la RAM de tus Legends ({Object.entries(report.ram).map(([c, n]) => `${c} ${n}`).join(' · ')}). Arrastra cartas al mazo; arrastra una carta del mazo aquí para quitarla.</p>}

          <CardList
            cards={cards}
            grouped={filters.sort === 'set'}
            view={view}
            compact
            renderTile={(c) => {
              const ram = ramReason(c)
              return (
                <CardTile
                  key={c.id}
                  card={c}
                  preview={bind(c)}
                  dragData={`card:${c.id}`}
                  dim={loggedIn && ownedOf(c.id) === 0}
                  locked={!!ram}
                  lockReason={ram}
                  lockLabel={ramShort(c)}
                  badge={usedBadge(c)}
                  onClick={() => add(c)}
                  footer={
                    <div className="row between small tile-controls">
                      {loggedIn ? <span className={ownedOf(c.id) ? '' : 'muted'}>Tengo {ownedOf(c.id)}</span> : <button className="link-btn" onClick={() => modal.open(c.id)}>Detalle</button>}
                      {addButton(c)}
                    </div>
                  }
                />
              )
            }}
            renderRow={(c) => {
              const ram = ramReason(c)
              return (
                <CardRow
                  key={c.id}
                  card={c}
                  preview={bind(c)}
                  dragData={`card:${c.id}`}
                  dim={loggedIn && ownedOf(c.id) === 0}
                  locked={!!ram}
                  lockReason={ram}
                  badge={usedBadge(c)}
                  onClick={() => modal.open(c.id)}
                  right={<>{loggedIn && <span className="muted small">Tengo {ownedOf(c.id)}</span>}{addButton(c)}</>}
                />
              )
            }}
          />
          {cards.length === 0 && <p className="empty">Ninguna carta coincide con los filtros.</p>}
        </div>

        <aside className="editor-deck">
          <input className="input title-input" value={deck.name} maxLength={64} onChange={(e) => edit((d) => ({ ...d, name: e.target.value || 'Sin nombre' }))} aria-label="Nombre del mazo" />
          <div className="deck-id">
            <ColorCode legendIds={deck.legendIds} />
            <span className="row small">
              <span className={`pill ${report.errors.length ? 'bad' : report.isValid ? 'ok' : 'warn'}`}>{report.errors.length ? 'Ilegal' : report.isValid ? 'Legal' : 'Borrador'}</span>
              <span className="muted">Se guarda solo</span>
            </span>
          </div>

          <div className="counters">
            <span className={report.legendCount === RULES.legends ? 'ok' : ''}>Legends {report.legendCount}/{RULES.legends}</span>
            <span className={report.mainCount >= RULES.minMain && report.mainCount <= RULES.maxMain ? 'ok' : report.mainCount > RULES.maxMain ? 'bad' : ''}>Mazo {report.mainCount} ({RULES.minMain}–{RULES.maxMain})</span>
            <span className={report.sideCount <= RULES.maxSide ? '' : 'bad'}>Side {report.sideCount}/{RULES.maxSide}</span>
          </div>
          <div className="ram-bar" aria-label="RAM disponible por color">
            {Object.keys(report.ram).length === 0 ? <span className="muted small">RAM: elige Legends para calcularla</span> : Object.entries(report.ram).map(([c, n]) => <span key={c} className="ram-chip"><ColorDot color={c} />{c} {n}</span>)}
          </div>

          {report.errors.length > 0 && <ul className="errors">{report.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          {report.errors.length === 0 && report.incomplete.length > 0 && <ul className="warns">{report.incomplete.map((e) => <li key={e}>{e}</li>)}</ul>}
          {loggedIn && <p className={`pill ${missingTotal ? 'bad' : 'ok'}`}>{missingTotal ? `Te faltan ${missingTotal} carta(s) para montarlo` : 'Tienes todas las cartas de este mazo'}</p>}

          <h3>Legends</h3>
          <div className={`legend-slots ${dropZone === 'legend' ? 'drop-on' : ''}`} {...zoneProps('legend')}>
            {legendSlots.map((c, i) =>
              c ? (
                <div key={c.id} className="slot filled" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', `deck:legend:${c.id}`); e.dataTransfer.effectAllowed = 'move' }}>
                  <button className="slot-art" onClick={() => modal.open(c.id)} {...bind(c)} aria-label={c.displayName}><CardImage card={c} /></button>
                  <span className="slot-name small">{c.displayName}{loggedIn && ownedOf(c.id) < 1 && <span className="pill bad">no la tienes</span>}</span>
                  <button className="btn sm" onClick={() => edit((d) => ({ ...d, legendIds: d.legendIds.filter((x) => x !== c.id) }))} aria-label={`Quitar ${c.displayName}`}>✕</button>
                </div>
              ) : (
                <div key={`empty-${i}`} className="slot empty"><span className="muted small">Legend {i + 1}</span></div>
              ),
            )}
          </div>

          <h3>Mazo principal</h3>
          <ul className={`plain zone ${dropZone === 'main' ? 'drop-on' : ''}`} {...zoneProps('main')}>
            {zoneRows(mainRows, deck.main, 'main')}
            {mainRows.length === 0 && <li className="muted small">Pulsa o arrastra cartas aquí.</li>}
          </ul>

          <h3>Sideboard</h3>
          <ul className={`plain zone ${dropZone === 'side' ? 'drop-on' : ''}`} {...zoneProps('side')}>
            {zoneRows(sideRows, deck.side, 'side')}
            {sideRows.length === 0 && <li className="muted small">Hasta {RULES.maxSide} cartas.</li>}
          </ul>

          <details className="analytics" open>
            <summary>Análisis del mazo</summary>
            <h4>Curva de coste (eddies)</h4>
            <CostCurveChart buckets={curve} />
            <h4>Ratio de tipos</h4>
            <TypeDonut slices={ratio} />
          </details>

          <div className="row wrap actions">
            <button className="btn" onClick={() => setPanel(panel === 'export' ? 'none' : 'export')}>Exportar / compartir</button>
            <button className="btn" onClick={() => setPanel(panel === 'import' ? 'none' : 'import')}>Importar</button>
            {loggedIn && missingText && <button className="btn" onClick={() => void copy('Faltantes copiados', missingText)}>Copiar faltantes</button>}
            <button className="btn ghost" onClick={() => window.confirm(`¿Borrar "${deck.name}"?`) && void deleteDeck(deck.id).then(() => nav('/decks'))}>Borrar</button>
          </div>

          {panel === 'export' && (
            <div className="panel">
              <textarea className="input mono" rows={10} readOnly value={exportText} onFocus={(e) => e.currentTarget.select()} aria-label="Lista del mazo en texto" />
              <div className="row wrap">
                <button className="btn primary" onClick={() => void copy('Lista copiada', exportText)}>Copiar lista</button>
                <button className="btn" onClick={() => downloadText(`${deck.name.replace(/[^\w-]+/g, '_')}.txt`, exportText)}>Descargar .txt</button>
              </div>
              <p className="muted small">Código para compartir (cualquiera puede importarlo en esta web):</p>
              <textarea className="input mono" rows={3} readOnly value={shareCode} onFocus={(e) => e.currentTarget.select()} aria-label="Código del mazo" />
              <div className="row wrap">
                <button className="btn" disabled={!shareCode} onClick={() => void copy('Código copiado', shareCode)}>Copiar código</button>
                <button className="btn" disabled={!shareCode} onClick={() => void copy('Enlace copiado', shareLink)}>Copiar enlace</button>
              </div>
            </div>
          )}
          {panel === 'import' && (
            <div className="panel">
              <p className="muted small">Reemplaza el contenido de este mazo. Acepta la lista en texto.</p>
              <textarea className="input mono" rows={10} maxLength={MAX_IMPORT_CHARS} value={importText} onChange={(e) => setImportText(e.target.value)} />
              {importReport.length > 0 && <ul className="errors">{importReport.map((r) => <li key={r}>{r}</li>)}</ul>}
              <button className="btn primary" onClick={doImport} disabled={!importText.trim()}>Importar</button>
            </div>
          )}
        </aside>

        {notice && <p className="toast floating" role="status">{notice}</p>}
        {layer}
        <CardModal card={modal.card} onClose={modal.close}>
          {modal.card && (
            <>
              {ramReason(modal.card) && <p className="errors">🔒 {ramReason(modal.card)}</p>}
              <div className="row">
                <button className="btn primary" disabled={!!blockReason(modal.card)} title={blockReason(modal.card)} onClick={() => add(modal.card!)}>
                  Añadir al {modal.card.type === 'Legend' ? 'mazo (Legend)' : target === 'main' ? 'mazo' : 'sideboard'}
                </button>
                {blockReason(modal.card) && <span className="muted small">{blockReason(modal.card)}</span>}
              </div>
              {loggedIn && <InventoryEditor cardId={modal.card.id} />}
            </>
          )}
        </CardModal>
      </section>
    </>
  )
}

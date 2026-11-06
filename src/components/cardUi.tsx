import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode, type TouchEvent } from 'react'
import { catalog, setLabel } from '../lib/catalog'
import { thumbOf } from '../lib/images'
import { printsOf, type PrintEntry } from '../lib/prints'
import { altLabel } from '../lib/variants'
import type { Card } from '../lib/types'

export const imgUrl = (card: Card): string => `${import.meta.env.BASE_URL}${card.image}`
const assetUrl = (path: string): string => `${import.meta.env.BASE_URL}${path}`

/** Texto corto que explica de dónde sale la imagen de una impresión; vacío si es la suya. */
export function artNote(print: PrintEntry): string {
  if (print.art === 'likely') return 'Arte probable: no tenemos la imagen de esta impresión y se muestra otro arte del mismo ilustrador'
  if (print.art === 'marked') return 'Impresión promocional: misma ilustración que la carta normal, pero lleva una marca de promoción (p. ej. «Judge») que no aparece en esta imagen'
  if (print.art === 'unknown') return 'Arte distinto al original sin imagen disponible: se muestra la carta original como referencia'
  return ''
}

/** Imagen de una carta. Con `thumb` se usa la miniatura (si no existe, la completa). */
export function CardImage({ card, className, src, thumb }: { card: Card; className?: string; /** Imagen concreta (p. ej. la de una impresión); por defecto, la de la carta. */ src?: string; thumb?: boolean }) {
  const path = src ?? card.image
  const full = assetUrl(path)
  return (
    <img
      className={className}
      src={thumb ? assetUrl(thumbOf(path)) : full}
      onError={thumb ? (e) => { if (!e.currentTarget.dataset.full) { e.currentTarget.dataset.full = '1'; e.currentTarget.src = full } } : undefined}
      alt={card.displayName}
      loading="lazy"
      draggable={false}
    />
  )
}

/* ---------- vista cuadrícula / lista ---------- */

export type ViewMode = 'grid' | 'list'
const VIEW_KEY = 'ncd.view.v1'

export function useViewMode(): [ViewMode, (v: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
    } catch {
      return 'grid'
    }
  })
  const update = useCallback((v: ViewMode) => {
    setMode(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* sin almacenamiento: se mantiene en memoria */
    }
  }, [])
  return [mode, update]
}

export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="seg" role="group" aria-label="Tipo de vista">
      <button className={value === 'grid' ? 'on' : ''} onClick={() => onChange('grid')} aria-pressed={value === 'grid'}>▦ Galería</button>
      <button className={value === 'list' ? 'on' : ''} onClick={() => onChange('list')} aria-pressed={value === 'list'}>☰ Lista</button>
    </div>
  )
}

/* ---------- previsualización: hover (ratón) y pulsación larga (táctil) ---------- */

const LONG_PRESS_MS = 450

interface PreviewState {
  card: Card
  /** Imagen de una impresión concreta; por defecto, la de la carta. */
  image?: string
  x: number
  y: number
  touch: boolean
}

export interface PreviewBind {
  onMouseEnter: (e: MouseEvent) => void
  onMouseMove: (e: MouseEvent) => void
  onMouseLeave: () => void
  onTouchStart: (e: TouchEvent) => void
  onTouchEnd: () => void
  onTouchMove: () => void
  onTouchCancel: () => void
  onClickCapture: (e: MouseEvent) => void
  onContextMenu: (e: MouseEvent) => void
}

export function usePreview() {
  const [state, setState] = useState<PreviewState | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const suppressClick = useRef(false)
  const canHover = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches, [])

  const clearTimer = () => {
    window.clearTimeout(timer.current)
    timer.current = undefined
  }
  useEffect(() => clearTimer, [])

  const bind = useCallback(
    (card: Card, image?: string): PreviewBind => ({
      onMouseEnter: (e) => canHover && setState({ card, image, x: e.clientX, y: e.clientY, touch: false }),
      onMouseMove: (e) => canHover && setState((s) => (s && !s.touch ? { ...s, x: e.clientX, y: e.clientY } : s)),
      onMouseLeave: () => setState((s) => (s && !s.touch ? null : s)),
      onTouchStart: () => {
        clearTimer()
        timer.current = window.setTimeout(() => {
          suppressClick.current = true
          setState({ card, image, x: 0, y: 0, touch: true })
        }, LONG_PRESS_MS)
      },
      onTouchEnd: () => {
        clearTimer()
        setState((s) => (s?.touch ? null : s))
      },
      onTouchMove: clearTimer,
      onTouchCancel: () => {
        clearTimer()
        setState((s) => (s?.touch ? null : s))
      },
      onClickCapture: (e) => {
        if (suppressClick.current) {
          suppressClick.current = false
          e.stopPropagation()
          e.preventDefault()
        }
      },
      onContextMenu: (e) => {
        // en móvil la pulsación larga abre el menú del navegador sobre la imagen: lo evitamos
        if (!canHover) e.preventDefault()
      },
    }),
    [canHover],
  )

  const layer = state ? <PreviewLayer state={state} /> : null
  return { bind, layer }
}

function PreviewLayer({ state }: { state: PreviewState }) {
  const W = 320
  const H = Math.round(W * 1.4)
  let style: React.CSSProperties
  if (state.touch) {
    style = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  } else {
    const margin = 18
    const right = state.x + margin + W < window.innerWidth
    const left = right ? state.x + margin : Math.max(8, state.x - margin - W)
    const top = Math.min(Math.max(8, state.y - H / 2), Math.max(8, window.innerHeight - H - 8))
    style = { left, top }
  }
  return (
    <div className={`preview ${state.touch ? 'touch' : ''}`} style={style} aria-hidden="true">
      <img src={state.image ? assetUrl(state.image) : imgUrl(state.card)} alt="" width={W} />
    </div>
  )
}

/* ---------- ficha de carta y fila de lista ---------- */

interface GroupedListProps<T> {
  items: T[]
  /** Lista completa cuando `items` es solo una página: los encabezados cuentan todo el grupo, no solo lo visible. */
  all?: T[]
  /** Grupo al que pertenece cada elemento; null = sin encabezados. Los elementos de un grupo deben ir seguidos. */
  groupOf: ((item: T) => { key: string; label: string }) | null
  /** Palabra que cuenta los elementos en el encabezado ("cartas", "impresiones"). */
  unit: string
  view: ViewMode
  compact?: boolean
  renderTile: (item: T) => ReactNode
  renderRow: (item: T) => ReactNode
}

/** Galería o lista, dividida en bloques con encabezado cuando hay agrupación. */
export function GroupedList<T>({ items, all, groupOf, unit, view, compact, renderTile, renderRow }: GroupedListProps<T>) {
  const totals = useMemo(() => {
    const m = new Map<string, number>()
    if (groupOf) for (const it of all ?? items) m.set(groupOf(it).key, (m.get(groupOf(it).key) ?? 0) + 1)
    return m
  }, [all, items, groupOf])
  const groups = useMemo(() => {
    if (!groupOf) return [{ key: 'all', label: '', items }]
    const out: { key: string; label: string; items: T[] }[] = []
    for (const it of items) {
      const g = groupOf(it)
      const last = out[out.length - 1]
      if (last && last.key === g.key) last.items.push(it)
      else out.push({ key: g.key, label: g.label, items: [it] })
    }
    return out
  }, [items, groupOf])

  return (
    <>
      {groups.map((g) => (
        <section key={g.key} className="setgroup">
          {g.label && (
            <h2 className="set-head">
              <span>{g.label}</span>
              <small>{totals.get(g.key) ?? g.items.length} {unit}</small>
            </h2>
          )}
          {view === 'grid' ? (
            <div className={`grid ${compact ? 'compact' : ''}`}>{g.items.map(renderTile)}</div>
          ) : (
            <div className="list">{g.items.map(renderRow)}</div>
          )}
        </section>
      ))}
    </>
  )
}

const groupByCardSet = (c: Card) => ({ key: c.setCode, label: setLabel(c) })

interface CardListProps {
  cards: Card[]
  /** Todas las cartas si `cards` es una página (para contar bien los encabezados). */
  all?: Card[]
  /** Con orden "set y número" se separan los sets con encabezados. */
  grouped: boolean
  view: ViewMode
  compact?: boolean
  renderTile: (card: Card) => ReactNode
  renderRow: (card: Card) => ReactNode
}

/** Galería o lista de cartas; con orden por set, dividida en bloques con su encabezado. */
export function CardList({ cards, all, grouped, view, compact, renderTile, renderRow }: CardListProps) {
  return <GroupedList items={cards} all={all} groupOf={grouped ? groupByCardSet : null} unit="cartas" view={view} compact={compact} renderTile={renderTile} renderRow={renderRow} />
}

const groupByPrintSet = (e: PrintEntry) => ({ key: e.setName, label: setLabel({ setName: e.setName }) })

interface PrintListProps {
  prints: PrintEntry[]
  /** Todas las impresiones si `prints` es una página. */
  all?: PrintEntry[]
  grouped: boolean
  view: ViewMode
  renderTile: (print: PrintEntry) => ReactNode
  renderRow: (print: PrintEntry) => ReactNode
}

/** Galería o lista de impresiones; con orden por set, dividida por set. */
export function PrintList({ prints, all, grouped, view, renderTile, renderRow }: PrintListProps) {
  return <GroupedList items={prints} all={all} groupOf={grouped ? groupByPrintSet : null} unit="impresiones" view={view} renderTile={renderTile} renderRow={renderRow} />
}

export function ColorDot({ color }: { color: string | null }) {
  return <span className={`dot dot-${(color ?? 'none').toLowerCase()}`} title={color ?? 'Sin color'} />
}

interface DragProps {
  dragData?: string
  onDragStart?: (e: DragEvent) => void
}

export interface TileProps extends DragProps {
  card: Card
  onClick?: () => void
  badge?: ReactNode
  footer?: ReactNode
  dim?: boolean
  /** Bloqueada por una restricción (p. ej. RAM): se atenúa y muestra un candado. */
  locked?: boolean
  lockReason?: string
  /** Texto corto bajo "BLOQUEADA" (p. ej. "RAM Blue 3 > 2"). */
  lockLabel?: string
  preview?: PreviewBind
  /** Si se indica, la ficha representa esa impresión (su imagen, set y número) en vez de la carta en general. */
  print?: PrintEntry
}

/** Etiqueta sobre la imagen: número de coleccionista, con aviso si la imagen no es exactamente la de la impresión. */
function PrintTag({ print }: { print: PrintEntry }) {
  const note = artNote(print)
  return (
    <span className={`print-tag ${note ? 'approx' : ''}`} title={note || `${print.setName} #${print.collectorNumber ?? '?'}`}>
      {print.collectorNumber ? `#${print.collectorNumber}` : '#?'}
      {note && <b aria-label="Imagen aproximada"> ≈</b>}
    </span>
  )
}

const startDrag = (data: string | undefined) => (e: DragEvent) => {
  if (!data) return
  e.dataTransfer.setData('text/plain', data)
  e.dataTransfer.effectAllowed = 'copyMove'
}

export function CardTile({ card, onClick, badge, footer, dim, locked, lockReason, lockLabel, preview, dragData, print }: TileProps) {
  return (
    <div className={`tile ${dim ? 'dim' : ''} ${locked ? 'locked' : ''}`}>
      <button
        className="tile-art"
        onClick={onClick}
        aria-label={`${card.displayName}${print ? `, ${setLabel({ setName: print.setName })} ${print.collectorNumber ? `#${print.collectorNumber}` : ''}` : ''}${locked && lockReason ? `. ${lockReason}` : ''}`}
        draggable={!!dragData}
        onDragStart={startDrag(dragData)}
        {...preview}
      >
        <CardImage card={card} src={print?.image} thumb />
        {print && <PrintTag print={print} />}
        {locked && (
          <span className="tile-lockbox" title={lockReason} aria-hidden="true">
            <b>🔒 BLOQUEADA</b>
            {lockLabel && <small>{lockLabel}</small>}
          </span>
        )}
        {badge != null && <span className="tile-badge">{badge}</span>}
      </button>
      {footer && <div className="tile-foot">{footer}</div>}
    </div>
  )
}

export function CardRow({ card, onClick, badge, right, dim, locked, lockReason, preview, dragData, print }: Omit<TileProps, 'footer'> & { right?: ReactNode }) {
  return (
    <div className={`crow ${dim ? 'dim' : ''} ${locked ? 'locked' : ''}`} draggable={!!dragData} onDragStart={startDrag(dragData)}>
      <button className="crow-main" onClick={onClick} title={locked ? lockReason : undefined} {...preview}>
        <img className="crow-thumb" src={assetUrl(thumbOf(print?.image ?? card.image))} alt="" loading="lazy" draggable={false} />
        <span className="crow-name">
          {locked && <span aria-label="Bloqueada">🔒 </span>}
          <ColorDot color={card.color} />
          {card.displayName}
          {print && <span className="muted small"> · {setLabel({ setName: print.setName })} {print.collectorNumber ? `#${print.collectorNumber}` : ''}{artNote(print) ? ' ≈' : ''}</span>}
        </span>
        <span className="crow-meta muted">{card.type}</span>
        <span className="crow-num" title="Coste">{card.cost ?? '–'}</span>
        <span className="crow-num" title="RAM">{card.ram ?? '–'}</span>
        <span className="crow-meta muted hide-sm">{card.classifications.slice(0, 2).join(', ')}</span>
        <span className="crow-chips hide-sm">
          {card.altArts.length > 0 && <span className="chip" title={`${card.altArts.length} artes alternativos`}>ALT</span>}
          {card.printings.some((p) => p.language === 'fr') && <span className="chip" title="Tiene versión francesa">FR</span>}
        </span>
        {badge != null && <span className="tile-badge static">{badge}</span>}
      </button>
      {right && <div className="crow-right">{right}</div>}
    </div>
  )
}

export function Stepper({ value, onChange, min = 0, max = 999, disableAdd, addTitle, title, disabled }: { value: number; onChange: (n: number) => void; min?: number; max?: number; disableAdd?: boolean; addTitle?: string; title?: string; /** Bloquea ambos botones (p. ej. mientras cargan los datos). */ disabled?: boolean }) {
  return (
    <div className="stepper" title={disabled ? 'Cargando tus datos…' : title}>
      <button className="btn sm" onClick={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min} aria-label="Quitar uno">−</button>
      <span className="stepper-n">{value}</span>
      <button className="btn sm" onClick={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max || disableAdd} title={disableAdd ? addTitle : undefined} aria-label="Añadir uno">+</button>
    </div>
  )
}

/* ---------- modal ---------- */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function CardModal({ card, printKey, onClose, children }: { card: Card | null; /** Impresión con la que se abre (p. ej. al pulsarla en una lista por set). */ printKey?: string | null; onClose: () => void; children?: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null)
  const isOpen = card !== null
  // onClose puede cambiar de identidad en cada render del padre: se guarda en una ref para que el efecto
  // de foco solo se ejecute al abrir/cerrar (si no, cada clic en + devolvía el foco —y el scroll— arriba).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Impresión (set + número) y arte que se ven en grande (-1 = el original; 0… = un arte alternativo).
  // Al abrir se calculan desde la impresión pedida EN EL MISMO RENDER (sin efecto): así el detalle nunca
  // enseña un instante la imagen base antes de saltar a la de la promo. Lo que el usuario elige dentro del
  // detalle se guarda aparte y solo vale para esa apertura.
  const prints = useMemo(() => (card ? printsOf(card) : []), [card])
  const openKey = `${card?.id ?? ''}|${printKey ?? ''}`
  const initial = useMemo(() => {
    const first = printKey ? prints.find((p) => p.key === printKey) : undefined
    return { openKey, key: first?.key ?? null, art: first?.altIndex ?? -1 }
  }, [openKey, printKey, prints])
  const [chosen, setChosen] = useState<{ openKey: string; key: string | null; art: number } | null>(null)
  const view = chosen && chosen.openKey === openKey ? chosen : initial
  const art = view.art
  const print = prints.find((p) => p.key === view.key) ?? null
  // al cerrar se olvida lo elegido: la próxima apertura vuelve a empezar en la impresión pedida
  useEffect(() => {
    if (!card) setChosen(null)
  }, [card])
  const pickPrint = (e: PrintEntry) => setChosen({ openKey, key: e.key, art: e.altIndex })
  const pickArt = (i: number) =>
    setChosen({ openKey, art: i, key: (i < 0 ? prints.find((p) => p.isOriginal) : prints.find((p) => p.altIndex === i && p.art === 'exact'))?.key ?? null })

  // foco: entra en el diálogo, se queda dentro (Tab) y vuelve a donde estaba al cerrar
  useEffect(() => {
    if (!isOpen) return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLElement>('.modal-x')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onCloseRef.current()
      if (e.key !== 'Tab' || !dialog.current) return
      const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [isOpen])

  if (!card) return null
  const shown = art >= 0 ? card.altArts[art] : undefined
  const gallery = card.altArts.map((a, i) => ({ a, i })).filter((x) => x.a.image)
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label={card.displayName} onClick={(e) => e.stopPropagation()}>
        <button className="modal-x btn ghost" onClick={onClose} aria-label="Cerrar">✕</button>
        {/* .modal es el marco fijo (borde y relleno); el scroll ocurre en .modal-scroll, para que el fondo cubra TODO el contenido */}
        <div className="modal-scroll">
        <div className="modal-visual">
          {shown?.image ? (
            <img className="modal-img" src={`${import.meta.env.BASE_URL}${shown.image}`} alt={`${card.displayName} — ${altLabel(shown)}`} draggable={false} />
          ) : (
            <CardImage card={card} className="modal-img" />
          )}
          {gallery.length > 0 && (
            <div className="thumbs" role="group" aria-label="Variantes de arte">
              <button type="button" className="thumb" aria-pressed={art < 0} aria-label="Arte original" title="Arte original" onClick={() => pickArt(-1)}>
                <img src={assetUrl(thumbOf(card.image))} alt="" loading="lazy" draggable={false} />
              </button>
              {gallery.map(({ a, i }) => (
                <button key={`${a.id}-${i}`} type="button" className="thumb" aria-pressed={art === i} aria-label={altLabel(a)} title={altLabel(a)} onClick={() => pickArt(i)}>
                  <img src={assetUrl(thumbOf(a.image as string))} alt="" loading="lazy" draggable={false} />
                </button>
              ))}
            </div>
          )}
          {print && artNote(print) && <p className="muted small art-note">≈ {artNote(print)}.</p>}
        </div>
        <div className="modal-info">
          <h2>{card.displayName}</h2>
          <p className="meta">
            <ColorDot color={card.color} /> {card.type} · {card.rarity} ·{' '}
            {print ? <>{setLabel({ setName: print.setName })} · #{print.collectorNumber ?? '?'}</> : <>{setLabel(card)} · #{card.importId}</>}
          </p>
          <dl className="stats">
            {card.cost != null && <><dt>Coste</dt><dd>{card.cost}</dd></>}
            {card.power != null && <><dt>Poder</dt><dd>{card.power}</dd></>}
            {card.ram != null && <><dt>RAM</dt><dd>{card.ram}</dd></>}
          </dl>
          {card.classifications.length > 0 && <p className="tags">{card.classifications.map((t) => <span key={t}>{t}</span>)}</p>}
          <p className="rules">{card.rules}</p>
          {card.flavor && <p className="flavor">{card.flavor}</p>}
          {(print?.artist ?? card.artist) && <p className="muted small">Ilustración: {print?.artist ?? card.artist}</p>}
          <VariantsInfo card={card} prints={prints} activePrint={print?.key ?? null} onPickPrint={pickPrint} activeArt={art} onPickArt={pickArt} />
          {children}
        </div>
        </div>
      </div>
    </div>
  )
}


/** Impresiones por set (agrupando idiomas) y artes alternativos; los que tienen imagen se pueden ver en grande. */
interface VariantsProps {
  card: Card
  /** Impresiones de la carta; si no se pasan se calculan. */
  prints?: PrintEntry[]
  activePrint?: string | null
  onPickPrint?: (print: PrintEntry) => void
  activeArt?: number
  onPickArt?: (index: number) => void
}

export function VariantsInfo({ card, prints: given, activePrint, onPickPrint, activeArt, onPickArt }: VariantsProps) {
  const prints = useMemo(() => given ?? printsOf(card), [given, card])
  const setCount = useMemo(() => new Set(prints.map((p) => p.setName)).size, [prints])
  if (prints.length === 0 && card.altArts.length === 0) return null
  return (
    <details className="variants" open>
      <summary>Variantes e impresiones ({setCount} sets{card.altArts.length > 0 ? `, ${card.altArts.length} artes alternativos` : ''})</summary>
      {prints.length > 0 && (
        <ul className="plain small">
          {prints.map((p) => {
            const fr = card.printings.some((x) => x.language === 'fr' && x.baseSetName === p.setName)
            const label = `${p.setName}${p.collectorNumber ? ` #${p.collectorNumber}` : ''}`
            return (
              <li key={p.key} className={`variant-row print-row ${activePrint === p.key ? 'current' : ''}`}>
                {onPickPrint ? (
                  <button type="button" className="print-btn" aria-pressed={activePrint === p.key} onClick={() => onPickPrint(p)}>{p.setName}</button>
                ) : (
                  <span>{p.setName}</span>
                )}
                <span className="muted mono">{p.collectorNumber ? `#${p.collectorNumber}` : ''}</span>
                <span className="langs" aria-label={label}>
                  {p.isOriginal && <span className="lang">ORIGINAL</span>}
                  {artNote(p) && <span className="lang" title={artNote(p)}>≈ ARTE</span>}
                  <span className="lang lang-en">EN</span>
                  {fr && <span className="lang lang-fr">FR</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {card.altArts.length > 0 && (
        <>
          <h4 className="small">Artes alternativos</h4>
          <ul className="plain small">
            {card.altArts.map((a, i) => (
              <li key={`${a.id}-${i}`} className={`variant-row ${activeArt === i ? 'active' : ''}`}>
                {a.image && onPickArt ? (
                  <button type="button" className="link-btn" aria-pressed={activeArt === i} onClick={() => onPickArt(i)}>{altLabel(a)}</button>
                ) : (
                  <span>{altLabel(a)}</span>
                )}
                <span className="muted">{[a.baseSetName, a.collectorNumber && `#${a.collectorNumber}`, a.artist].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
          {onPickArt && card.altArts.some((a) => a.image) && <p className="muted small">Pulsa una miniatura o una variante de la lista para verla en grande.</p>}
        </>
      )}
    </details>
  )
}

export function useCardModal() {
  const [open, setOpen] = useState<{ id: string; printKey: string | null } | null>(null)
  const card = useMemo(() => (open ? catalog.byId[open.id] ?? null : null), [open])
  const close = useCallback(() => setOpen(null), [])
  const show = useCallback((id: string, printKey?: string) => setOpen({ id, printKey: printKey ?? null }), [])
  return { card, printKey: open?.printKey ?? null, open: show, close }
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

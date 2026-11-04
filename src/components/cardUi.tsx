import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode, type TouchEvent } from 'react'
import { catalog, setLabel } from '../lib/catalog'
import type { AltArt, Card } from '../lib/types'

export const imgUrl = (card: Card): string => `${import.meta.env.BASE_URL}${card.image}`

export function CardImage({ card, className }: { card: Card; className?: string }) {
  return <img className={className} src={imgUrl(card)} alt={card.displayName} loading="lazy" draggable={false} />
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
    (card: Card): PreviewBind => ({
      onMouseEnter: (e) => canHover && setState({ card, x: e.clientX, y: e.clientY, touch: false }),
      onMouseMove: (e) => canHover && setState((s) => (s && !s.touch ? { ...s, x: e.clientX, y: e.clientY } : s)),
      onMouseLeave: () => setState((s) => (s && !s.touch ? null : s)),
      onTouchStart: () => {
        clearTimer()
        timer.current = window.setTimeout(() => {
          suppressClick.current = true
          setState({ card, x: 0, y: 0, touch: true })
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
      <img src={imgUrl(state.card)} alt="" width={W} />
    </div>
  )
}

/* ---------- ficha de carta y fila de lista ---------- */

interface CardListProps {
  cards: Card[]
  /** Con orden "set y número" se separan los sets con encabezados. */
  grouped: boolean
  view: ViewMode
  compact?: boolean
  renderTile: (card: Card) => ReactNode
  renderRow: (card: Card) => ReactNode
}

/** Galería o lista de cartas; con orden por set, dividida en bloques con su encabezado. */
export function CardList({ cards, grouped, view, compact, renderTile, renderRow }: CardListProps) {
  const groups = useMemo(() => {
    if (!grouped) return [{ key: 'all', label: '', cards }]
    const out: { key: string; label: string; cards: Card[] }[] = []
    for (const c of cards) {
      const last = out[out.length - 1]
      if (last && last.key === c.setCode) last.cards.push(c)
      else out.push({ key: c.setCode, label: setLabel(c), cards: [c] })
    }
    return out
  }, [cards, grouped])

  return (
    <>
      {groups.map((g) => (
        <section key={g.key} className="setgroup">
          {g.label && (
            <h2 className="set-head">
              <span>{g.label}</span>
              <small>{g.cards.length} cartas</small>
            </h2>
          )}
          {view === 'grid' ? (
            <div className={`grid ${compact ? 'compact' : ''}`}>{g.cards.map(renderTile)}</div>
          ) : (
            <div className="list">{g.cards.map(renderRow)}</div>
          )}
        </section>
      ))}
    </>
  )
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
}

const startDrag = (data: string | undefined) => (e: DragEvent) => {
  if (!data) return
  e.dataTransfer.setData('text/plain', data)
  e.dataTransfer.effectAllowed = 'copyMove'
}

export function CardTile({ card, onClick, badge, footer, dim, locked, lockReason, lockLabel, preview, dragData }: TileProps) {
  return (
    <div className={`tile ${dim ? 'dim' : ''} ${locked ? 'locked' : ''}`}>
      <button
        className="tile-art"
        onClick={onClick}
        aria-label={`${card.displayName}${locked && lockReason ? `. ${lockReason}` : ''}`}
        draggable={!!dragData}
        onDragStart={startDrag(dragData)}
        {...preview}
      >
        <CardImage card={card} />
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

export function CardRow({ card, onClick, badge, right, dim, locked, lockReason, preview, dragData }: Omit<TileProps, 'footer'> & { right?: ReactNode }) {
  return (
    <div className={`crow ${dim ? 'dim' : ''} ${locked ? 'locked' : ''}`} draggable={!!dragData} onDragStart={startDrag(dragData)}>
      <button className="crow-main" onClick={onClick} title={locked ? lockReason : undefined} {...preview}>
        <img className="crow-thumb" src={imgUrl(card)} alt="" loading="lazy" draggable={false} />
        <span className="crow-name">
          {locked && <span aria-label="Bloqueada">🔒 </span>}
          <ColorDot color={card.color} />
          {card.displayName}
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

export function Stepper({ value, onChange, min = 0, max = 999, disableAdd, addTitle, title }: { value: number; onChange: (n: number) => void; min?: number; max?: number; disableAdd?: boolean; addTitle?: string; title?: string }) {
  return (
    <div className="stepper" title={title}>
      <button className="btn sm" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Quitar uno">−</button>
      <span className="stepper-n">{value}</span>
      <button className="btn sm" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max || disableAdd} title={disableAdd ? addTitle : undefined} aria-label="Añadir uno">+</button>
    </div>
  )
}

/* ---------- modal ---------- */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function CardModal({ card, onClose, children }: { card: Card | null; onClose: () => void; children?: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null)
  const isOpen = card !== null
  // onClose puede cambiar de identidad en cada render del padre: se guarda en una ref para que el efecto
  // de foco solo se ejecute al abrir/cerrar (si no, cada clic en + devolvía el foco —y el scroll— arriba).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // arte que se ve en grande: -1 = el original; 0… = un arte alternativo. Se restablece al cambiar de carta.
  const [art, setArt] = useState(-1)
  useEffect(() => setArt(-1), [card?.id])

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
        <div className="modal-visual">
          {shown?.image ? (
            <img className="modal-img" src={`${import.meta.env.BASE_URL}${shown.image}`} alt={`${card.displayName} — ${altLabel(shown)}`} draggable={false} />
          ) : (
            <CardImage card={card} className="modal-img" />
          )}
          {gallery.length > 0 && (
            <div className="thumbs" role="group" aria-label="Variantes de arte">
              <button type="button" className="thumb" aria-pressed={art < 0} aria-label="Arte original" title="Arte original" onClick={() => setArt(-1)}>
                <img src={imgUrl(card)} alt="" loading="lazy" draggable={false} />
              </button>
              {gallery.map(({ a, i }) => (
                <button key={`${a.id}-${i}`} type="button" className="thumb" aria-pressed={art === i} aria-label={altLabel(a)} title={altLabel(a)} onClick={() => setArt(i)}>
                  <img src={`${import.meta.env.BASE_URL}${a.image}`} alt="" loading="lazy" draggable={false} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="modal-info">
          <h2>{card.displayName}</h2>
          <p className="meta">
            <ColorDot color={card.color} /> {card.type} · {card.rarity} · {setLabel(card)} · #{card.importId}
          </p>
          <dl className="stats">
            {card.cost != null && <><dt>Coste</dt><dd>{card.cost}</dd></>}
            {card.power != null && <><dt>Poder</dt><dd>{card.power}</dd></>}
            {card.ram != null && <><dt>RAM</dt><dd>{card.ram}</dd></>}
          </dl>
          {card.classifications.length > 0 && <p className="tags">{card.classifications.map((t) => <span key={t}>{t}</span>)}</p>}
          <p className="rules">{card.rules}</p>
          {card.flavor && <p className="flavor">{card.flavor}</p>}
          {card.artist && <p className="muted small">Ilustración: {card.artist}</p>}
          <VariantsInfo card={card} activeArt={art} onPickArt={setArt} />
          {children}
        </div>
      </div>
    </div>
  )
}

const altLabel = (a: AltArt): string => [a.rarity, a.label].filter(Boolean).join(' · ') || 'Arte alternativo'

/** Impresiones por set (agrupando idiomas) y artes alternativos; los que tienen imagen se pueden ver en grande. */
export function VariantsInfo({ card, activeArt, onPickArt }: { card: Card; activeArt?: number; onPickArt?: (index: number) => void }) {
  const sets = useMemo(() => {
    const m = new Map<string, { name: string; nums: Set<string>; langs: Set<string> }>()
    for (const p of card.printings) {
      const e = m.get(p.baseSetName) ?? { name: p.baseSetName, nums: new Set<string>(), langs: new Set<string>() }
      if (p.collectorNumber) e.nums.add(p.collectorNumber)
      e.langs.add(p.language)
      m.set(p.baseSetName, e)
    }
    return [...m.values()]
  }, [card])
  if (sets.length === 0 && card.altArts.length === 0) return null
  return (
    <details className="variants" open>
      <summary>Variantes e impresiones ({sets.length} sets{card.altArts.length > 0 ? `, ${card.altArts.length} artes alternativos` : ''})</summary>
      {sets.length > 0 && (
        <ul className="plain small">
          {sets.map((s) => (
            <li key={s.name} className="variant-row">
              <span>{s.name}</span>
              <span className="muted mono">{[...s.nums].map((n) => `#${n}`).join(' ')}</span>
              <span className="langs">{[...s.langs].sort().map((l) => <span key={l} className={`lang lang-${l}`}>{l.toUpperCase()}</span>)}</span>
            </li>
          ))}
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
  const [id, setId] = useState<string | null>(null)
  const card = useMemo(() => (id ? catalog.byId[id] ?? null : null), [id])
  const close = useCallback(() => setId(null), [])
  return { card, open: setId, close }
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

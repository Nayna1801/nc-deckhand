import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode, type TouchEvent } from 'react'
import { catalog, COLORS, RARITIES, setLabel, TYPES } from '../lib/catalog'
import { exceedsRam } from '../lib/deckRules'
import { parseSearch, SEARCH_EXAMPLES, SEARCH_FIELDS, SEARCH_NOTES } from '../lib/search'
import type { Card, Quantities } from '../lib/types'

export const imgUrl = (card: Card): string => `${import.meta.env.BASE_URL}${card.image}`

export function CardImage({ card, className }: { card: Card; className?: string }) {
  return <img className={className} src={imgUrl(card)} alt={card.displayName} loading="lazy" draggable={false} />
}

/* ---------- filtros y orden ---------- */

export type SortKey = 'set' | 'cost' | 'name' | 'number'

export interface Filters {
  q: string
  type: string
  color: string
  rarity: string
  set: string
  faction: string
  cost: string
  ram: string
  sort: SortKey
  owned: 'all' | 'owned' | 'missing'
  /** Oculta (en vez de atenuar) las cartas que superan la RAM de las Legends elegidas. */
  hideLocked: boolean
}

export const EMPTY_FILTERS: Filters = { q: '', type: '', color: '', rarity: '', set: '', faction: '', cost: '', ram: '', sort: 'set', owned: 'all', hideLocked: false }

const SETS = [...new Set(catalog.cards.flatMap((c) => c.printings.map((p) => p.baseSetName)))].sort((a, b) => a.localeCompare(b))
const FACTIONS = [...new Set(catalog.cards.flatMap((c) => c.classifications))].sort((a, b) => a.localeCompare(b))
const COSTS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9+']
const RAMS = ['1', '2', '3', '4', '5', '6+']

const matchesBucket = (value: number | null, bucket: string): boolean => {
  if (value == null) return false
  return bucket.endsWith('+') ? value >= parseInt(bucket, 10) : value === parseInt(bucket, 10)
}

const numberOf = (c: Card): number => parseInt(c.importId ?? '', 10) || 0

const SORTERS: Record<SortKey, ((a: Card, b: Card) => number) | null> = {
  set: null,
  cost: (a, b) => (a.cost ?? 99) - (b.cost ?? 99) || a.displayName.localeCompare(b.displayName),
  name: (a, b) => a.displayName.localeCompare(b.displayName),
  number: (a, b) => numberOf(a) - numberOf(b) || a.setCode.localeCompare(b.setCode),
}

export interface FilterContext {
  owned?: Quantities
  /** Legends elegidas en el constructor: activa el filtro de RAM restrictivo. */
  legendIds?: string[]
}

export function applyFilters(cards: Card[], f: Filters, ctx: FilterContext = {}): Card[] {
  const search = parseSearch(f.q)
  const out = cards.filter((c) => {
    if (f.type && c.type !== f.type) return false
    if (f.color && c.color !== f.color) return false
    if (f.rarity && c.rarity !== f.rarity) return false
    if (f.set && !c.printings.some((p) => p.baseSetName === f.set)) return false
    if (f.faction && !c.classifications.includes(f.faction)) return false
    if (f.cost && !matchesBucket(c.cost, f.cost)) return false
    if (f.ram && !matchesBucket(c.ram, f.ram)) return false
    if (ctx.owned && f.owned === 'owned' && !(ctx.owned[c.id] > 0)) return false
    if (ctx.owned && f.owned === 'missing' && ctx.owned[c.id] > 0) return false
    if (f.hideLocked && ctx.legendIds && exceedsRam(c, ctx.legendIds, catalog)) return false
    return search.match(c)
  })
  const sorter = SORTERS[f.sort]
  return sorter ? [...out].sort(sorter) : out
}

export function FilterBar({ value, onChange, showOwned, showRam }: { value: Filters; onChange: (f: Filters) => void; showOwned: boolean; showRam?: boolean }) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onChange({ ...value, [k]: v })
  const queryErrors = useMemo(() => parseSearch(value.q).errors, [value.q])
  const active = JSON.stringify({ ...value, sort: 'set' }) !== JSON.stringify({ ...EMPTY_FILTERS, sort: 'set' })
  const sel = (k: 'type' | 'color' | 'rarity' | 'faction' | 'cost' | 'ram', label: string, opts: readonly string[]) => (
    <select className="input" value={value[k]} onChange={(e) => set(k, e.target.value)} aria-label={label}>
      <option value="">{label}</option>
      {opts.map((o) => <option key={o}>{o}</option>)}
    </select>
  )
  return (
    <div className="filters">
      <div className="searchbox grow">
        <input className="input" type="search" placeholder={'Buscar… prueba t:unit c:red cost<=2 o:"draw"'} value={value.q} onChange={(e) => set('q', e.target.value)} aria-label="Buscar" aria-describedby={queryErrors.length ? 'search-errors' : undefined} />
        <SearchHelp onPick={(q) => set('q', q)} />
      </div>
      {sel('type', 'Tipo', TYPES)}
      {sel('color', 'Color', COLORS)}
      {sel('cost', 'Coste', COSTS)}
      {sel('ram', 'RAM', RAMS)}
      {sel('faction', 'Facción', FACTIONS)}
      {sel('rarity', 'Rareza', RARITIES)}
      <select className="input" value={value.set} onChange={(e) => set('set', e.target.value)} aria-label="Set">
        <option value="">Set (todas las impresiones)</option>
        {SETS.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <select className="input" value={value.sort} onChange={(e) => set('sort', e.target.value as SortKey)} aria-label="Ordenar por">
        <option value="set">Orden: set</option>
        <option value="cost">Orden: coste</option>
        <option value="name">Orden: nombre</option>
        <option value="number">Orden: número</option>
      </select>
      {showOwned && (
        <select className="input" value={value.owned} onChange={(e) => set('owned', e.target.value as Filters['owned'])} aria-label="Colección">
          <option value="all">Todas</option>
          <option value="owned">Las que tengo</option>
          <option value="missing">Las que me faltan</option>
        </select>
      )}
      {showRam && (
        <label className="check" title="Oculta las cartas que superan la RAM de tus Legends">
          <input type="checkbox" checked={value.hideLocked} onChange={(e) => set('hideLocked', e.target.checked)} /> Ocultar bloqueadas por RAM
        </label>
      )}
      {active && <button className="btn ghost" onClick={() => onChange({ ...EMPTY_FILTERS, sort: value.sort })}>Limpiar</button>}
      {queryErrors.length > 0 && (
        <ul id="search-errors" className="warns search-errors" role="status">
          {queryErrors.map((e) => <li key={e}>{e} (se ignora esa condición)</li>)}
        </ul>
      )}
    </div>
  )
}

function SearchHelp({ onPick }: { onPick: (q: string) => void }) {
  return (
    <details className="searchhelp">
      <summary title="Ayuda de búsqueda" aria-label="Ayuda de sintaxis de búsqueda">?</summary>
      <div className="searchhelp-body">
        <p className="muted small">Escribe palabras para buscar por nombre, texto o facción, o usa campos:</p>
        <table>
          <tbody>
            {SEARCH_FIELDS.map((f) => (
              <tr key={f.example}>
                <td><button className="link-btn mono" onClick={() => onPick(f.example)}>{f.example}</button></td>
                <td className="small">{f.description}{f.aliases.length > 1 && <span className="muted"> · alias: {f.aliases.join(', ')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="plain small">{SEARCH_NOTES.map((n) => <li key={n}>{n}</li>)}</ul>
        <p className="small"><strong>Ejemplos:</strong></p>
        <div className="row wrap">{SEARCH_EXAMPLES.map((e) => <button key={e} className="btn sm mono" onClick={() => onPick(e)}>{e}</button>)}</div>
      </div>
    </details>
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
  preview?: PreviewBind
}

const startDrag = (data: string | undefined) => (e: DragEvent) => {
  if (!data) return
  e.dataTransfer.setData('text/plain', data)
  e.dataTransfer.effectAllowed = 'copyMove'
}

export function CardTile({ card, onClick, badge, footer, dim, locked, lockReason, preview, dragData }: TileProps) {
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
        {locked && <span className="tile-lock" title={lockReason} aria-hidden="true">🔒</span>}
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

export function Stepper({ value, onChange, min = 0, max = 999, disableAdd, addTitle }: { value: number; onChange: (n: number) => void; min?: number; max?: number; disableAdd?: boolean; addTitle?: string }) {
  return (
    <div className="stepper">
      <button className="btn sm" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Quitar uno">−</button>
      <span className="stepper-n">{value}</span>
      <button className="btn sm" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max || disableAdd} title={disableAdd ? addTitle : undefined} aria-label="Añadir uno">+</button>
    </div>
  )
}

/* ---------- modal ---------- */

export function CardModal({ card, onClose, children }: { card: Card | null; onClose: () => void; children?: ReactNode }) {
  useEffect(() => {
    if (!card) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, onClose])
  if (!card) return null
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label={card.displayName} onClick={(e) => e.stopPropagation()}>
        <button className="modal-x btn ghost" onClick={onClose} aria-label="Cerrar">✕</button>
        <CardImage card={card} className="modal-img" />
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
          <VariantsInfo card={card} />
          {children}
        </div>
      </div>
    </div>
  )
}

/** Impresiones por set (agrupando idiomas) y artes alternativas. Solo información: no incluye imágenes de variantes. */
export function VariantsInfo({ card }: { card: Card }) {
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
              <li key={`${a.id}-${i}`} className="variant-row">
                <span>{[a.rarity, a.label].filter(Boolean).join(' · ') || 'Arte alternativo'}</span>
                <span className="muted">{[a.baseSetName, a.collectorNumber && `#${a.collectorNumber}`, a.artist].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">Solo se muestra la información; las imágenes de las variantes no se incluyen.</p>
        </>
      )}
    </details>
  )
}

export function useCardModal() {
  const [id, setId] = useState<string | null>(null)
  const card = useMemo(() => (id ? catalog.byId[id] ?? null : null), [id])
  return { card, open: setId, close: () => setId(null) }
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

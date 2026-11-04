import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { catalog, COLORS, normalizeText, RARITIES, setLabel, TYPES } from '../lib/catalog'
import type { Card, Quantities } from '../lib/types'

export const imgUrl = (card: Card): string => `${import.meta.env.BASE_URL}${card.image}`

export function CardImage({ card, className }: { card: Card; className?: string }) {
  return <img className={className} src={imgUrl(card)} alt={card.displayName} loading="lazy" draggable={false} />
}

/* ---------- filtros ---------- */

export interface Filters {
  q: string
  type: string
  color: string
  rarity: string
  set: string
  owned: 'all' | 'owned' | 'missing'
}

export const EMPTY_FILTERS: Filters = { q: '', type: '', color: '', rarity: '', set: '', owned: 'all' }

const SETS = [...new Map(catalog.cards.map((c) => [c.setCode, setLabel(c)])).entries()]

export function applyFilters(cards: Card[], f: Filters, owned?: Quantities): Card[] {
  const q = normalizeText(f.q)
  return cards.filter((c) => {
    if (f.type && c.type !== f.type) return false
    if (f.color && c.color !== f.color) return false
    if (f.rarity && c.rarity !== f.rarity) return false
    if (f.set && c.setCode !== f.set) return false
    if (owned && f.owned === 'owned' && !(owned[c.id] > 0)) return false
    if (owned && f.owned === 'missing' && owned[c.id] > 0) return false
    if (q) {
      const hay = normalizeText([c.displayName, c.rules, c.classifications.join(' '), c.importId ?? ''].join(' '))
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function FilterBar({ value, onChange, showOwned }: { value: Filters; onChange: (f: Filters) => void; showOwned: boolean }) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onChange({ ...value, [k]: v })
  const active = JSON.stringify(value) !== JSON.stringify(EMPTY_FILTERS)
  return (
    <div className="filters">
      <input className="input grow" type="search" placeholder="Buscar nombre, texto, tribu, código…" value={value.q} onChange={(e) => set('q', e.target.value)} />
      <select className="input" value={value.type} onChange={(e) => set('type', e.target.value)} aria-label="Tipo">
        <option value="">Tipo</option>
        {TYPES.map((t) => <option key={t}>{t}</option>)}
      </select>
      <select className="input" value={value.color} onChange={(e) => set('color', e.target.value)} aria-label="Color">
        <option value="">Color</option>
        {COLORS.map((c) => <option key={c}>{c}</option>)}
      </select>
      <select className="input" value={value.rarity} onChange={(e) => set('rarity', e.target.value)} aria-label="Rareza">
        <option value="">Rareza</option>
        {RARITIES.map((r) => <option key={r}>{r}</option>)}
      </select>
      <select className="input" value={value.set} onChange={(e) => set('set', e.target.value)} aria-label="Set">
        <option value="">Set</option>
        {SETS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      </select>
      {showOwned && (
        <select className="input" value={value.owned} onChange={(e) => set('owned', e.target.value as Filters['owned'])} aria-label="Colección">
          <option value="all">Todas</option>
          <option value="owned">Las que tengo</option>
          <option value="missing">Las que me faltan</option>
        </select>
      )}
      {active && <button className="btn ghost" onClick={() => onChange(EMPTY_FILTERS)}>Limpiar</button>}
    </div>
  )
}

/* ---------- tarjeta ---------- */

export function ColorDot({ color }: { color: string | null }) {
  return <span className={`dot dot-${(color ?? 'none').toLowerCase()}`} title={color ?? 'Sin color'} />
}

export function CardTile({ card, onClick, badge, footer, dim }: { card: Card; onClick?: () => void; badge?: ReactNode; footer?: ReactNode; dim?: boolean }) {
  return (
    <div className={`tile ${dim ? 'dim' : ''}`}>
      <button className="tile-art" onClick={onClick} aria-label={`Ver ${card.displayName}`}>
        <CardImage card={card} />
        {badge != null && <span className="tile-badge">{badge}</span>}
      </button>
      {footer && <div className="tile-foot">{footer}</div>}
    </div>
  )
}

export function Stepper({ value, onChange, min = 0, max = 999 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <div className="stepper">
      <button className="btn sm" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Quitar uno">−</button>
      <span className="stepper-n">{value}</span>
      <button className="btn sm" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Añadir uno">+</button>
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
          {children}
        </div>
      </div>
    </div>
  )
}

export function useCardModal() {
  const [id, setId] = useState<string | null>(null)
  const card = useMemo(() => (id ? catalog.byId[id] ?? null : null), [id])
  return { card, open: setId, close: () => setId(null) }
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

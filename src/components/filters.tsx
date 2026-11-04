import { useEffect, useMemo, useRef, useState } from 'react'
import { catalog, compareBySetAndNumber, COLORS, RARITIES, TYPES } from '../lib/catalog'
import { exceedsRam } from '../lib/deckRules'
import { keywordsOf, parseSearch, SEARCH_EXAMPLES, SEARCH_FIELDS, SEARCH_NOTES } from '../lib/search'
import type { Card, Quantities } from '../lib/types'
import { Dropdown, type Option } from './Dropdown'

export type SortKey = 'set' | 'cost' | 'name'
export type OwnedFilter = 'all' | 'owned' | 'missing' | 'wanted'

export interface Filters {
  q: string
  type: string
  color: string
  rarity: string
  set: string
  faction: string
  cost: string
  ram: string
  power: string
  keyword: string
  trigger: string
  sort: SortKey
  owned: OwnedFilter
  /** Oculta (en vez de atenuar) las cartas que superan la RAM de las Legends elegidas. */
  hideLocked: boolean
}

export const EMPTY_FILTERS: Filters = {
  q: '', type: '', color: '', rarity: '', set: '', faction: '', cost: '', ram: '', power: '',
  keyword: '', trigger: '', sort: 'set', owned: 'all', hideLocked: false,
}

/* ---------- opciones ---------- */

const ALL: Option = { value: '', label: 'Todos' }
const list = (values: readonly string[]): Option[] => [ALL, ...values.map((v) => ({ value: v, label: v }))]

const FACTIONS = [...new Set(catalog.cards.flatMap((c) => c.classifications))].sort((a, b) => a.localeCompare(b))
const SETS = [...new Set(catalog.cards.flatMap((c) => c.printings.map((p) => p.baseSetName)))].sort((a, b) => a.localeCompare(b))

const OPTIONS = {
  type: list(TYPES),
  color: list(COLORS),
  rarity: list(RARITIES),
  faction: list(FACTIONS),
  set: [ALL, ...SETS.map((s) => ({ value: s, label: s }))],
  cost: list(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9+']),
  ram: list(['1', '2', '3', '4', '5', '6+']),
  power: [ALL, { value: 'u5', label: 'Menos de 5' }, { value: '5-9', label: '5 a 9' }, { value: '10+', label: '10 o más' }],
  keyword: [ALL, { value: 'blocker', label: 'Blocker' }, { value: 'gosolo', label: 'Go Solo' }, { value: 'adrenaline', label: 'Adrenaline' }, { value: 'quick', label: 'Quick' }],
  trigger: [
    ALL,
    { value: 'play', label: 'Al jugarla (Play)' },
    { value: 'attack', label: 'Al atacar (Attack)' },
    { value: 'call', label: 'Al ser llamada (Call)' },
    { value: 'defeated', label: 'Al ser derrotada (Defeated)' },
    { value: 'spend', label: 'Habilidad Spend' },
  ],
  sort: [{ value: 'set', label: 'Set y número' }, { value: 'cost', label: 'Coste' }, { value: 'name', label: 'Nombre' }],
} satisfies Record<string, Option[]>

const matchesBucket = (value: number | null, bucket: string): boolean => {
  if (value == null) return false
  return bucket.endsWith('+') ? value >= parseInt(bucket, 10) : value === parseInt(bucket, 10)
}

const powerMatches = (power: number | null, bucket: string): boolean => {
  if (power == null) return false
  if (bucket === 'u5') return power < 5
  if (bucket === '5-9') return power >= 5 && power <= 9
  return power >= 10
}

const SORTERS: Record<SortKey, (a: Card, b: Card) => number> = {
  set: compareBySetAndNumber,
  cost: (a, b) => (a.cost ?? 99) - (b.cost ?? 99) || a.displayName.localeCompare(b.displayName),
  name: (a, b) => a.displayName.localeCompare(b.displayName),
}

export interface FilterContext {
  owned?: Quantities
  wanted?: Quantities
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
    if (f.power && !powerMatches(c.power, f.power)) return false
    if (f.keyword || f.trigger) {
      const kw = keywordsOf(c)
      if (f.keyword && !kw.has(f.keyword)) return false
      if (f.trigger && !kw.has(f.trigger)) return false
    }
    if (ctx.owned && f.owned === 'owned' && !(ctx.owned[c.id] > 0)) return false
    if (ctx.owned && f.owned === 'missing' && ctx.owned[c.id] > 0) return false
    if (f.owned === 'wanted' && !(ctx.wanted && ctx.wanted[c.id] > 0)) return false
    if (f.hideLocked && ctx.legendIds && exceedsRam(c, ctx.legendIds, catalog)) return false
    return search.match(c)
  })
  return [...out].sort(SORTERS[f.sort])
}

/** Número de filtros activos (sin contar búsqueda ni orden). */
export function activeFilterCount(f: Filters): number {
  const keys: (keyof Filters)[] = ['type', 'color', 'rarity', 'set', 'faction', 'cost', 'ram', 'power', 'keyword', 'trigger']
  return keys.filter((k) => f[k] !== '').length + (f.owned !== 'all' ? 1 : 0) + (f.hideLocked ? 1 : 0)
}

/**
 * El filtro "tengo / me faltan / deseo" se evalúa sobre una instantánea que solo se refresca al
 * cambiar de filtro. Así, al pulsar + o ♥ sobre una carta, no desaparece de la lista a mitad de edición.
 */
export function useSnapshot<T>(value: T, resetKey: string): T {
  const [snap, setSnap] = useState(value)
  const latest = useRef(value)
  latest.current = value
  useEffect(() => setSnap(latest.current), [resetKey])
  return snap
}

/* ---------- barra de filtros ---------- */

const DEBOUNCE_MS = 250

interface BarProps {
  value: Filters
  onChange: (f: Filters) => void
  showOwned: boolean
  showWanted?: boolean
  showRam?: boolean
}

export function FilterBar({ value, onChange, showOwned, showWanted, showRam }: BarProps) {
  const [text, setText] = useState(value.q)
  const [open, setOpen] = useState(false)
  const committed = useRef(value.q)
  const latest = useRef({ value, onChange })
  latest.current = { value, onChange }
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onChange({ ...value, [k]: v })

  // cambios externos del texto (limpiar, ejemplos, enlaces) -> reflejarlos en el campo
  useEffect(() => {
    if (value.q !== committed.current) {
      committed.current = value.q
      setText(value.q)
    }
  }, [value.q])

  // debounce: la lista se recalcula cuando el usuario deja de teclear
  useEffect(() => {
    if (text === committed.current) return
    const t = window.setTimeout(() => {
      committed.current = text
      latest.current.onChange({ ...latest.current.value, q: text })
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [text])

  const errors = useMemo(() => parseSearch(value.q).errors, [value.q])
  const active = activeFilterCount(value)
  const dirty = active > 0 || value.q !== '' || text !== ''

  const ownedOptions: Option[] = [
    { value: 'all', label: 'Todas' },
    { value: 'owned', label: 'Las que tengo' },
    { value: 'missing', label: 'Las que me faltan' },
    ...(showWanted ? [{ value: 'wanted', label: 'Las que deseo' }] : []),
  ]

  return (
    <section className="fpanel" aria-label="Búsqueda y filtros">
      <div className="frow">
        <div className="searchbox">
          <input
            className="input"
            type="search"
            maxLength={200}
            placeholder={'Buscar… prueba t:unit c:red cost<=2 o:"draw"'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Buscar"
            aria-describedby={errors.length ? 'search-errors' : undefined}
          />
          <SearchHelp onPick={(q) => set('q', q)} />
        </div>
        <Dropdown label="Orden" value={value.sort} options={OPTIONS.sort} onChange={(v) => set('sort', v as SortKey)} />
        <button type="button" className={`btn fp-toggle ${open ? 'on' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Filtros{active > 0 ? ` (${active})` : ''} {open ? '▴' : '▾'}
        </button>
      </div>

      <div className={`fadv ${open ? 'open' : ''}`}>
        <Dropdown label="Tipo" value={value.type} options={OPTIONS.type} onChange={(v) => set('type', v)} />
        <Dropdown label="Color" value={value.color} options={OPTIONS.color} onChange={(v) => set('color', v)} />
        <Dropdown label="Coste" value={value.cost} options={OPTIONS.cost} onChange={(v) => set('cost', v)} />
        <Dropdown label="RAM" value={value.ram} options={OPTIONS.ram} onChange={(v) => set('ram', v)} />
        <Dropdown label="Poder" value={value.power} options={OPTIONS.power} onChange={(v) => set('power', v)} />
        <Dropdown label="Keyword" value={value.keyword} options={OPTIONS.keyword} onChange={(v) => set('keyword', v)} />
        <Dropdown label="Efecto" value={value.trigger} options={OPTIONS.trigger} onChange={(v) => set('trigger', v)} />
        <Dropdown label="Facción" value={value.faction} options={OPTIONS.faction} onChange={(v) => set('faction', v)} />
        <Dropdown label="Rareza" value={value.rarity} options={OPTIONS.rarity} onChange={(v) => set('rarity', v)} />
        <Dropdown label="Set" value={value.set} options={OPTIONS.set} onChange={(v) => set('set', v)} />
        {showOwned && <Dropdown label="Colección" value={value.owned} options={ownedOptions} onChange={(v) => set('owned', v as OwnedFilter)} />}
        {showRam && (
          <label className="check" title="Oculta las cartas que superan la RAM de tus Legends">
            <input type="checkbox" checked={value.hideLocked} onChange={(e) => set('hideLocked', e.target.checked)} /> Ocultar bloqueadas
          </label>
        )}
        {dirty && (
          <button type="button" className="btn ghost" onClick={() => onChange({ ...EMPTY_FILTERS, sort: value.sort })}>
            Limpiar
          </button>
        )}
      </div>

      {errors.length > 0 && (
        <ul id="search-errors" className="warns search-errors" role="status">
          {errors.map((e) => <li key={e}>{e} (se ignora esa condición)</li>)}
        </ul>
      )}
    </section>
  )
}

function SearchHelp({ onPick }: { onPick: (q: string) => void }) {
  return (
    <details className="searchhelp">
      <summary title="Ayuda de búsqueda" aria-label="Ayuda de sintaxis de búsqueda">?</summary>
      <div className="searchhelp-body">
       <div className="searchhelp-scroll">
        <p className="muted small">Escribe palabras para buscar por nombre, texto o facción, o usa campos:</p>
        <table>
          <tbody>
            {SEARCH_FIELDS.map((f) => (
              <tr key={f.example}>
                <td><button type="button" className="link-btn mono" onClick={() => onPick(f.example)}>{f.example}</button></td>
                <td className="small">{f.description}{f.aliases.length > 1 && <span className="muted"> · alias: {f.aliases.join(', ')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="plain small">{SEARCH_NOTES.map((n) => <li key={n}>{n}</li>)}</ul>
        <p className="small"><strong>Ejemplos:</strong></p>
        <div className="row wrap">{SEARCH_EXAMPLES.map((e) => <button key={e} type="button" className="btn sm mono" onClick={() => onPick(e)}>{e}</button>)}</div>
       </div>
      </div>
    </details>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { catalog } from '../lib/catalog'
import type { AlbumSlot } from '../lib/album'
import { copiesOfVariant, type Inventory } from '../lib/inventory'
import { clampPage, PAGE_SIZE, pageItems } from '../lib/paging'
import { expandPrints } from '../lib/prints'
import { CardTile } from './cardUi'
import { applyFilters, EMPTY_FILTERS } from './filters'
import { Pager } from './Pager'

interface PickerProps {
  /** Texto del encabezado (p. ej. «Bolsillo 4»). */
  title: string
  loggedIn: boolean
  inventory: Inventory
  onPick: (slot: AlbumSlot) => void
  onClose: () => void
}

/** Ventana para elegir qué carta (y con qué arte) va en un bolsillo del álbum. */
export function AlbumPicker({ title, loggedIn, inventory, onPick, onClose }: PickerProps) {
  const [q, setQ] = useState('')
  const [onlyOwned, setOnlyOwned] = useState(loggedIn)
  const [onlyArts, setOnlyArts] = useState(false)
  const [page, setPage] = useState(1)
  const input = useRef<HTMLInputElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    input.current?.focus()
    document.documentElement.classList.add('modal-open')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.documentElement.classList.remove('modal-open')
      previous?.focus?.()
    }
  }, [])

  // una entrada por carta y diseño: el diseño base de una carta sale una vez aunque se imprimiera en varios sets
  const entries = useMemo(() => {
    const cards = applyFilters(catalog.cards, { ...EMPTY_FILTERS, q }, {})
    const seen = new Set<string>()
    return expandPrints(cards, { bySet: true }).filter((e) => {
      if (onlyArts && e.variantKey === null) return false
      if (onlyOwned && copiesOfVariant(inventory[e.card.id], e.variantKey) === 0) return false
      const design = `${e.card.id}|${e.variantKey ?? 'base'}`
      if (seen.has(design)) return false
      seen.add(design)
      return true
    })
  }, [q, onlyOwned, onlyArts, inventory])

  useEffect(() => setPage(1), [q, onlyOwned, onlyArts])
  const current = clampPage(page, entries.length)
  const shown = useMemo(() => pageItems(entries, current), [entries, current])

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal picker" role="dialog" aria-modal="true" aria-label={`Elegir carta: ${title}`} onClick={(e) => e.stopPropagation()}>
        <button className="modal-x btn ghost" onClick={onClose} aria-label="Cerrar">✕</button>
        <div className="modal-scroll picker-body">
          <div className="picker-head">
            <h2>Elegir carta <small className="muted">{title}</small></h2>
            <input ref={input} type="search" className="input" placeholder="Buscar carta… (t:unit c:red)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar carta para el álbum" maxLength={120} />
            <div className="row wrap">
              {loggedIn && (
                <label className="check"><input type="checkbox" checked={onlyOwned} onChange={(e) => setOnlyOwned(e.target.checked)} /> Solo las que tengo</label>
              )}
              <label className="check" title="Solo artes alternativos y promos con diseño propio"><input type="checkbox" checked={onlyArts} onChange={(e) => setOnlyArts(e.target.checked)} /> Solo artes alternativos y promos</label>
              <span className="muted small">{entries.length} {entries.length === 1 ? 'carta' : 'cartas'}</span>
            </div>
          </div>
          <Pager page={current} total={entries.length} size={PAGE_SIZE} onChange={setPage} unit="cartas" />
          <div className="grid compact picker-grid">
            {shown.map((e) => {
              const n = copiesOfVariant(inventory[e.card.id], e.variantKey)
              return (
                <CardTile
                  key={e.key}
                  card={e.card}
                  print={e}
                  dim={loggedIn && n === 0}
                  badge={loggedIn && n > 0 ? `×${n}` : undefined}
                  onClick={() => onPick(e.variantKey === null ? { card: e.card.id } : { card: e.card.id, print: e.key })}
                />
              )
            })}
          </div>
          {entries.length === 0 && <p className="empty">{onlyOwned ? 'No tienes ninguna carta que coincida. Quita «Solo las que tengo» para colocar también las que te faltan.' : 'Ninguna carta coincide.'}</p>}
        </div>
      </div>
    </div>
  )
}

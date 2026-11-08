import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { catalog } from '../lib/catalog'
import type { AlbumSlot } from '../lib/album'
import { copiesOfVariant, type Inventory } from '../lib/inventory'
import { clampPage, PAGE_SIZE, pageItems } from '../lib/paging'
import type { PickerMemory } from '../lib/pickerMemory'
import { expandPrints } from '../lib/prints'
import { CardTile } from './cardUi'
import { applyFilters, EMPTY_FILTERS } from './filters'
import { Pager } from './Pager'

interface PickerProps {
  /** Texto del encabezado (p. ej. «Bolsillo 4»). */
  title: string
  loggedIn: boolean
  inventory: Inventory
  /** Dónde se quedó la última vez (búsqueda, filtros, página y scroll): la ventana vuelve a abrirse ahí. */
  memory: PickerMemory
  /** Se llama cada vez que cambia algo de lo que hay que recordar (y al cerrar). */
  onMemory: (m: PickerMemory) => void
  onPick: (slot: AlbumSlot) => void
  onClose: () => void
}

/** Ventana para elegir qué carta (y con qué arte) va en un bolsillo del álbum. Recuerda dónde te quedaste. */
export function AlbumPicker({ title, loggedIn, inventory, memory, onMemory, onPick, onClose }: PickerProps) {
  const defaultOwned = loggedIn
  const [q, setQ] = useState(memory.q)
  const [onlyOwned, setOnlyOwned] = useState(memory.onlyOwned ?? defaultOwned)
  const [onlyArts, setOnlyArts] = useState(memory.onlyArts)
  const [page, setPage] = useState(memory.page)
  const input = useRef<HTMLInputElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // lo último que hay que recordar, accesible desde los manejadores y desde el cierre
  const latest = useRef<PickerMemory>(memory)
  const onMemoryRef = useRef(onMemory)
  onMemoryRef.current = onMemory
  const frame = useRef<number | undefined>(undefined)

  useLayoutEffect(() => {
    // vuelve a la posición donde se dejó (las fichas tienen altura fija, así que el contenido ya mide lo mismo)
    if (scroller.current) scroller.current.scrollTop = memory.scroll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    // en pantallas táctiles no se abre el teclado solo (taparía las cartas y movería el scroll)
    if (!window.matchMedia?.('(pointer: coarse)').matches) input.current?.focus({ preventScroll: true })
    document.documentElement.classList.add('modal-open')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.documentElement.classList.remove('modal-open')
      if (frame.current !== undefined) window.cancelAnimationFrame(frame.current)
      onMemoryRef.current(latest.current)
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

  // al cambiar la búsqueda o un filtro se vuelve a la página 1 (pero no al abrir: ahí se respeta la página recordada)
  const filtersKey = `${q}|${onlyOwned}|${onlyArts}`
  const lastKey = useRef(filtersKey)
  useEffect(() => {
    if (lastKey.current === filtersKey) return
    lastKey.current = filtersKey
    setPage(1)
    if (scroller.current) scroller.current.scrollTop = 0
  }, [filtersKey])

  const current = clampPage(page, entries.length)
  const shown = useMemo(() => pageItems(entries, current), [entries, current])

  // se recuerda cada cambio de búsqueda, filtro o página
  useEffect(() => {
    latest.current = { q, onlyOwned, onlyArts, page: current, scroll: scroller.current?.scrollTop ?? 0 }
    onMemoryRef.current(latest.current)
  }, [q, onlyOwned, onlyArts, current])

  const onScroll = () => {
    if (frame.current !== undefined) return
    frame.current = window.requestAnimationFrame(() => {
      frame.current = undefined
      latest.current = { ...latest.current, scroll: scroller.current?.scrollTop ?? 0 }
      onMemoryRef.current(latest.current)
    })
  }

  const goTo = (n: number) => {
    setPage(n)
    if (scroller.current) scroller.current.scrollTop = 0
  }

  const pristine = q === '' && onlyOwned === defaultOwned && !onlyArts && current === 1
  const restart = () => {
    setQ('')
    setOnlyOwned(defaultOwned)
    setOnlyArts(false)
    goTo(1)
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal picker" role="dialog" aria-modal="true" aria-label={`Elegir carta: ${title}`} onClick={(e) => e.stopPropagation()}>
        <button className="modal-x btn ghost" onClick={onClose} aria-label="Cerrar">✕</button>
        <div ref={scroller} className="modal-scroll picker-body" onScroll={onScroll}>
          <div className="picker-head">
            <h2>Elegir carta <small className="muted">{title}</small></h2>
            <input ref={input} type="search" className="input" placeholder="Buscar carta… (t:unit c:red)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar carta para el álbum" maxLength={120} />
            <div className="row wrap">
              {loggedIn && (
                <label className="check"><input type="checkbox" checked={onlyOwned} onChange={(e) => setOnlyOwned(e.target.checked)} /> Solo las que tengo</label>
              )}
              <label className="check" title="Solo artes alternativos y promos con diseño propio"><input type="checkbox" checked={onlyArts} onChange={(e) => setOnlyArts(e.target.checked)} /> Solo artes alternativos y promos</label>
              <span className="muted small">{entries.length} {entries.length === 1 ? 'carta' : 'cartas'}</span>
              {!pristine && <button type="button" className="btn sm ghost" onClick={restart} title="Borra la búsqueda y los filtros y vuelve a la primera página">Empezar de cero</button>}
            </div>
          </div>
          <Pager page={current} total={entries.length} size={PAGE_SIZE} onChange={goTo} unit="cartas" />
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

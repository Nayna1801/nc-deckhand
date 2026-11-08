import { useEffect, useMemo, useRef, useState, type DragEvent, type TouchEvent } from 'react'
import { catalog, setLabel } from '../lib/catalog'
import {
  addPage, columnsOf, fillAlbum, filled, insertSlot, MAX_NAME, pageCount, pageSlots, PAGE_SIZES, removePage, removeSlot,
  setPerPage, setSlot, slotIndex, swapSlots, type AlbumSlot, type PerPage,
} from '../lib/album'
import { ownedEntries, type FillKind } from '../lib/albumFill'
import { copiesOfVariant, type Inventory } from '../lib/inventory'
import { loadPickerMemory, savePickerMemory, type PickerMemory } from '../lib/pickerMemory'
import { printsOf } from '../lib/prints'
import { AlbumPicker } from './AlbumPicker'
import { CardImage, CardModal, useCardModal } from './cardUi'
import { InventoryEditor } from './InventoryEditor'
import { useAlbum, type AlbumSyncStatus } from './useAlbum'

/** Carta y arte concretos de un bolsillo (null si la carta ya no existe en el catálogo). */
function resolve(slot: AlbumSlot) {
  const card = catalog.byId[slot.card]
  if (!card) return null
  const print = slot.print ? printsOf(card).find((p) => p.key === slot.print) ?? null : null
  return { card, print, image: print?.image ?? card.image }
}

/** Dos páginas a la vez (como un álbum abierto) cuando la pantalla es ancha. */
function useSpread(): boolean {
  const query = '(min-width: 1000px)'
  const [wide, setWide] = useState(() => (typeof window !== 'undefined' && window.matchMedia?.(query).matches) || false)
  useEffect(() => {
    const m = window.matchMedia?.(query)
    if (!m) return
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

/** Dónde se guarda el álbum: en la cuenta (se ve en todos los dispositivos) o solo en este navegador, y por qué. */
function SyncNote({ status, onRetry }: { status: AlbumSyncStatus; onRetry: () => void }) {
  if (status.state === 'missing') {
    return (
      <p className="notice small album-sync" role="status" data-sync="missing">
        Para tener el álbum en todos tus dispositivos, vuelve a ejecutar <code>supabase/schema.sql</code> en Supabase (es seguro repetirlo). Mientras tanto se guarda solo en este navegador.
      </p>
    )
  }
  if (status.state === 'error') {
    return (
      <p className="notice small album-sync" role="alert" data-sync="error">
        {status.message} <button type="button" className="btn sm" onClick={onRetry}>Reintentar</button>
      </p>
    )
  }
  const text: Record<string, string> = {
    local: 'El álbum se guarda en este navegador.',
    loading: 'Sincronizando el álbum con tu cuenta…',
    saving: 'Guardando el álbum en tu cuenta…',
    synced: 'Álbum sincronizado con tu cuenta: lo verás igual en tus otros dispositivos.',
  }
  return <p className="muted small album-sync" role="status" data-sync={status.state}>{text[status.state]}</p>
}

const PER_PAGE_LABEL: Record<PerPage, string> = { 4: '2×2', 9: '3×3', 12: '4×3' }
const FILL_LABEL: Record<FillKind, string> = { cards: 'Mis cartas', arts: 'Mis artes y promos', all: 'Todo junto' }

interface AlbumProps {
  userId: string | null | undefined
  loggedIn: boolean
  inventory: Inventory
}

/** Álbum de cartas: páginas de bolsillos donde colocas las cartas que quieras enseñar, en el orden y con el arte que elijas. */
export function Album({ userId, loggedIn, inventory }: AlbumProps) {
  const { album, update, status, retry } = useAlbum(userId)
  const spread = useSpread()
  const modal = useCardModal()
  const [page, setPage] = useState(0)
  const [edit, setEdit] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [pickFor, setPickFor] = useState<number | null>(null)
  const [fillKind, setFillKind] = useState<FillKind>('all')
  const [fillMode, setFillMode] = useState<'replace' | 'append'>('append')
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const touchX = useRef<number | null>(null)
  // dónde se quedó la ventana de elegir carta (búsqueda, filtros, página y scroll): se reabre ahí
  const pickerMemory = useRef<PickerMemory>(loadPickerMemory())

  const pages = pageCount(album)
  const step = spread ? 2 : 1
  const start = Math.min(Math.max(0, page), pages - 1) - (spread ? Math.min(Math.max(0, page), pages - 1) % 2 : 0)
  const cols = columnsOf(album.perPage)
  const fillCandidates = useMemo(() => ownedEntries(inventory, fillKind, catalog.cards), [inventory, fillKind])

  const goTo = (p: number) => {
    setPage(Math.min(Math.max(0, p), pages - 1))
    setSelected(null)
  }
  const flip = (dir: 1 | -1) => goTo(start + dir * step)

  const onTouchStart = (e: TouchEvent) => {
    touchX.current = e.touches[0]?.clientX ?? null
  }
  const onTouchEnd = (e: TouchEvent) => {
    const from = touchX.current
    touchX.current = null
    const to = e.changedTouches[0]?.clientX
    if (from === null || to === undefined || Math.abs(to - from) < 70) return
    flip(to < from ? 1 : -1)
  }

  const clickPocket = (g: number, slot: AlbumSlot | null) => {
    if (!edit) {
      const r = slot && resolve(slot)
      if (r) modal.open(r.card.id, r.print?.key)
      return
    }
    if (selected === null) {
      if (!slot) setPickFor(g)
      else setSelected(g)
      return
    }
    if (selected === g) return setSelected(null)
    update((a) => swapSlots(a, selected, g))
    setSelected(null)
  }

  const drop = (e: DragEvent, g: number) => {
    e.preventDefault()
    const from = Number(e.dataTransfer.getData('text/plain').replace('pocket:', ''))
    setDragFrom(null)
    if (Number.isInteger(from) && from !== g) update((a) => swapSlots(a, from, g))
  }

  const doFill = () => {
    if (fillCandidates.length === 0) return setNote('No tienes ninguna carta de ese tipo en tu colección.')
    if (fillMode === 'replace' && filled(album) > 0 && !window.confirm('Esto reemplaza todas las cartas que has colocado en el álbum. ¿Continuar?')) return
    update((a) => fillAlbum(a, fillCandidates, fillMode))
    setNote(`${fillCandidates.length} ${fillCandidates.length === 1 ? 'carta colocada' : 'cartas colocadas'}.`)
    setPage(0)
  }

  const renderPage = (p: number) => {
    if (p >= pages) return <div key={`blank-${p}`} className="album-page blank" aria-hidden="true" />
    return (
      <div key={`page-${p}-${album.perPage}`} className="album-page" data-page={p + 1}>
        <div className="album-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {pageSlots(album, p).map((slot, i) => {
            const g = slotIndex(album, p, i)
            const r = slot && resolve(slot)
            const owned = r ? copiesOfVariant(inventory[r.card.id], r.print?.variantKey ?? null) : 0
            const missing = !!r && loggedIn && owned === 0
            const label = r ? `${r.card.displayName}${r.print ? `, ${setLabel({ setName: r.print.setName })} ${r.print.collectorNumber ? `#${r.print.collectorNumber}` : ''}` : ''}` : `Bolsillo vacío ${g + 1}`
            return (
              <button
                key={g}
                type="button"
                className={`pocket ${r ? 'has' : 'empty'} ${missing ? 'missing' : ''} ${selected === g ? 'sel' : ''} ${dragFrom === g ? 'dragging' : ''}`}
                aria-label={label}
                aria-pressed={edit ? selected === g : undefined}
                data-slot={g}
                draggable={edit && !!r}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', `pocket:${g}`)
                  e.dataTransfer.effectAllowed = 'move'
                  setDragFrom(g)
                }}
                onDragEnd={() => setDragFrom(null)}
                onDragOver={(e) => edit && e.preventDefault()}
                onDrop={(e) => edit && drop(e, g)}
                onClick={() => clickPocket(g, slot)}
              >
                {r ? <CardImage card={r.card} src={r.image} thumb /> : edit ? <span className="pocket-plus" aria-hidden="true">+</span> : null}
                {missing && <span className="pocket-tag">No la tengo</span>}
                {r && owned > 1 && <span className="tile-badge">×{owned}</span>}
              </button>
            )
          })}
        </div>
        <span className="album-no">{p + 1}</span>
      </div>
    )
  }

  const shownPages = spread ? [start, start + 1] : [start]
  const selSlot = selected === null ? null : album.slots[selected] ?? null
  const selRes = selSlot && resolve(selSlot)
  const total = filled(album)

  return (
    <div className="album">
      <div className="album-bar">
        {edit ? (
          <input className="input album-name" value={album.name} maxLength={MAX_NAME} aria-label="Nombre del álbum" onChange={(e) => update((a) => ({ ...a, name: e.target.value.slice(0, MAX_NAME) }))} />
        ) : (
          <h2 className="album-title">{album.name}</h2>
        )}
        <span className="muted small album-count">{total} {total === 1 ? 'carta' : 'cartas'} · {pages} {pages === 1 ? 'página' : 'páginas'}</span>
        <div className="row wrap album-tools">
          <div className="seg" role="group" aria-label="Cartas por página">
            {PAGE_SIZES.map((n) => (
              <button key={n} className={album.perPage === n ? 'on' : ''} aria-pressed={album.perPage === n} title={`${n} cartas por página`} onClick={() => update((a) => setPerPage(a, n))}>{PER_PAGE_LABEL[n]}</button>
            ))}
          </div>
          <button className={`btn ${edit ? 'primary' : ''}`} aria-pressed={edit} onClick={() => { setEdit((v) => !v); setSelected(null) }}>{edit ? '✓ Terminar' : '✎ Editar álbum'}</button>
        </div>
      </div>

      <div className="album-book" data-spread={spread ? '2' : '1'} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {shownPages.map(renderPage)}
      </div>

      <nav className="album-nav" aria-label="Páginas del álbum">
        <button className="btn" disabled={start <= 0} onClick={() => flip(-1)} aria-label="Página anterior">‹ Anterior</button>
        <span className="album-where" aria-live="polite">
          {spread && start + 1 < pages ? `Páginas ${start + 1}–${start + 2}` : `Página ${start + 1}`} de {pages}
        </span>
        <button className="btn" disabled={start + step >= pages} onClick={() => flip(1)} aria-label="Página siguiente">Siguiente ›</button>
      </nav>

      {edit && (
        <div className="panel album-edit">
          <p className="muted small">
            {selected === null
              ? 'Toca un bolsillo vacío para elegir una carta. Toca una carta para seleccionarla y después otro bolsillo para moverla (o intercambiarla). En ordenador también puedes arrastrarlas.'
              : `Seleccionada: ${selRes?.card.displayName ?? `bolsillo ${selected + 1}`}. Toca otro bolsillo para moverla allí.`}
          </p>
          {selected !== null && (
            <div className="row wrap">
              <button className="btn sm" onClick={() => setPickFor(selected)}>Cambiar carta</button>
              <button className="btn sm" onClick={() => { update((a) => setSlot(a, selected, null)); setSelected(null) }}>Vaciar bolsillo</button>
              <button className="btn sm" title="Quita el bolsillo: los siguientes suben una posición" onClick={() => { update((a) => removeSlot(a, selected)); setSelected(null) }}>Quitar bolsillo</button>
              <button className="btn sm" title="Mete un hueco antes de este bolsillo: los siguientes bajan una posición" onClick={() => { update((a) => insertSlot(a, selected)); setSelected(null) }}>Insertar hueco antes</button>
              {selRes && <button className="btn sm" onClick={() => modal.open(selRes.card.id, selRes.print?.key)}>Ver carta</button>}
              <button className="btn sm ghost" onClick={() => setSelected(null)}>Cancelar</button>
            </div>
          )}
          <div className="row wrap">
            <button className="btn sm" onClick={() => { update(addPage); setPage(pageCount(addPage(album)) - 1); setSelected(null) }}>+ Añadir página</button>
            <button
              className="btn sm"
              disabled={pages <= 1}
              onClick={() => {
                const used = pageSlots(album, start).some(Boolean)
                if (used && !window.confirm(`La página ${start + 1} tiene cartas colocadas. ¿Quitarla?`)) return
                update((a) => removePage(a, start))
                setSelected(null)
              }}
            >
              Quitar página {start + 1}
            </button>
            <button
              className="btn sm ghost"
              disabled={album.slots.length === 0}
              onClick={() => window.confirm('¿Vaciar todo el álbum?') && (update((a) => ({ ...a, slots: [] })), setPage(0), setSelected(null))}
            >
              Vaciar álbum
            </button>
          </div>
        </div>
      )}

      {edit && loggedIn && (
        <details className="panel album-fill">
          <summary>Rellenar con mi colección</summary>
          <p className="muted small">Coloca de golpe lo que tienes, en el orden del catálogo. Después puedes mover, quitar o cambiar cualquier carta.</p>
          <div className="row wrap">
            <div className="seg" role="group" aria-label="Qué colocar">
              {(Object.keys(FILL_LABEL) as FillKind[]).map((k) => (
                <button key={k} className={fillKind === k ? 'on' : ''} aria-pressed={fillKind === k} onClick={() => setFillKind(k)}>{FILL_LABEL[k]}</button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Cómo colocarlas">
              <button className={fillMode === 'append' ? 'on' : ''} aria-pressed={fillMode === 'append'} onClick={() => setFillMode('append')}>Añadir al final</button>
              <button className={fillMode === 'replace' ? 'on' : ''} aria-pressed={fillMode === 'replace'} onClick={() => setFillMode('replace')}>Reemplazar todo</button>
            </div>
          </div>
          <div className="row wrap">
            <button className="btn primary" onClick={doFill}>Rellenar ({fillCandidates.length})</button>
            {note && <span className="small" role="status">{note}</span>}
          </div>
        </details>
      )}

      {!edit && total === 0 && (
        <p className="empty album-empty">
          Tu álbum está vacío. Pulsa <strong>Editar álbum</strong> para colocar tus cartas favoritas{loggedIn ? ' o rellenarlo con tu colección' : ''}.
        </p>
      )}
      <SyncNote status={status} onRetry={retry} />

      {pickFor !== null && (
        <AlbumPicker
          title={`bolsillo ${pickFor + 1}`}
          loggedIn={loggedIn}
          inventory={inventory}
          memory={pickerMemory.current}
          onMemory={(m) => {
            pickerMemory.current = m
            savePickerMemory(m)
          }}
          onClose={() => setPickFor(null)}
          onPick={(slot) => {
            update((a) => setSlot(a, pickFor, slot))
            setPickFor(null)
            setSelected(null)
          }}
        />
      )}
      <CardModal card={modal.card} printKey={modal.printKey} onClose={modal.close}>{modal.card && loggedIn && <InventoryEditor cardId={modal.card.id} />}</CardModal>
    </div>
  )
}

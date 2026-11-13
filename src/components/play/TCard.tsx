import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { catalog } from '../../lib/catalog'
import { thumbOf } from '../../lib/images'

export type HoverFn = (id: string | null, el: HTMLElement | null) => void

export interface TCardProps {
  /** id de la carta; null = boca abajo y desconocida (un dorso) */
  id: string | null
  power?: number
  spent?: boolean
  lag?: boolean
  solo?: boolean
  gone?: boolean
  isNew?: boolean
  selected?: boolean // la carta cuyas acciones se están viendo
  can?: boolean // se puede hacer algo con ella ahora
  cand?: boolean // es uno de los objetivos entre los que hay que elegir
  paid?: boolean // marcada para pagar con ella
  dropOk?: boolean // se está arrastrando algo que se puede soltar encima
  title?: string
  draggable?: boolean
  onClick?: () => void
  onHover?: HoverFn
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd?: () => void
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void
  onDrop?: (e: DragEvent<HTMLDivElement>) => void
  children?: ReactNode
}

/** Carta de la mesa de juego: se puede tocar, arrastrar y enseña un zoom al pasar el ratón (lo dibuja PlayBoard). */
export function TCard({ id, power, spent, lag, solo, gone, isNew, selected, can, cand, paid, dropOk, title, draggable, onClick, onHover, onDragStart, onDragEnd, onDragOver, onDrop, children }: TCardProps) {
  const card = id ? catalog.byId[id] : undefined
  const [broken, setBroken] = useState(false)
  const name = title ?? (id === null ? 'Carta oculta' : (card?.displayName ?? id))
  const cls = ['pt-card', id === null && 'back', spent && 'spent', lag && 'lag', solo && 'solo', gone && 'gone', isNew && 'new', selected && 'sel', can && 'can', cand && 'cand', paid && 'paid', dropOk && 'drop-ok', (broken || (id && !card)) && 'noimg']
    .filter(Boolean)
    .join(' ')
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      onClick()
    }
  }
  return (
    <div
      className={cls}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={name}
      aria-pressed={onClick ? !!selected : undefined}
      title={id === null ? name : undefined}
      draggable={draggable}
      onClick={onClick}
      onKeyDown={key}
      onMouseEnter={(e) => id && onHover?.(id, e.currentTarget)}
      onMouseLeave={() => onHover?.(null, null)}
      onFocus={(e) => id && onHover?.(id, e.currentTarget)}
      onBlur={() => onHover?.(null, null)}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', name)
        onHover?.(null, null)
        onDragStart?.(e)
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {id !== null && card && !broken && <img src={`${import.meta.env.BASE_URL}${thumbOf(card.image)}`} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />}
      {id === null ? <span className="pt-q">?</span> : <span className="pt-fb">{name}</span>}
      {power !== undefined && <span className="pt-pw">{power}</span>}
      {children}
    </div>
  )
}

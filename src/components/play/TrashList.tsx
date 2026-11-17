import { useEffect } from 'react'
import { TCard, type HoverFn } from './TCard'

interface Props {
  title: string
  cards: string[] // ids en el orden en que cayeron (la última es la de arriba)
  onClose: () => void
  onHover: HoverFn
}

/** Las cartas de una basura (es pública), de la más reciente a la más antigua. Se cierra con Esc, con el botón o tocando fuera. */
export function TrashList({ title, cards, onClose, onHover }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="pt-trash-back" onClick={onClose}>
      <div className="pt-trash" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>{title} <span>{cards.length} cartas · la más reciente primero</span></h3>
          <button type="button" className="btn sm" onClick={onClose} autoFocus>Cerrar</button>
        </header>
        <div className="pt-trash-cards">
          {cards.length === 0 && <p className="muted small">Vacía.</p>}
          {[...cards].reverse().map((id, k) => <TCard key={`${id}${k}`} id={id} onHover={onHover} />)}
        </div>
      </div>
    </div>
  )
}

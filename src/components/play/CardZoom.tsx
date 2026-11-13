import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { catalog } from '../../lib/catalog'
import { thumbOf } from '../../lib/images'

export interface Zoom {
  id: string
  rect: DOMRect
}

const DELAY_MS = 130
const WIDTH = 320
const GAP = 14

const canHover = () => typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches

/** Zoom al pasar el ratón por una carta: devuelve el zoom actual y la función que se pasa a cada carta. */
export function useHoverZoom() {
  const [zoom, setZoom] = useState<Zoom | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const onHover = useCallback((id: string | null, el: HTMLElement | null) => {
    window.clearTimeout(timer.current)
    if (!id || !el || !canHover()) return setZoom(null)
    timer.current = window.setTimeout(() => setZoom({ id, rect: el.getBoundingClientRect() }), DELAY_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return { zoom, onHover }
}

/** La carta en grande junto a la que tiene el ratón encima (a su derecha o, si no cabe, a su izquierda). No recoge el ratón. */
export function CardZoom({ zoom }: { zoom: Zoom | null }) {
  if (!zoom) return null
  const card = catalog.byId[zoom.id]
  if (!card) return null
  const vw = window.innerWidth
  const vh = window.innerHeight
  const height = Math.min(vh - 16, 580)
  let left = zoom.rect.right + GAP
  if (left + WIDTH > vw - 8) left = Math.max(8, zoom.rect.left - GAP - WIDTH)
  const top = Math.min(Math.max(8, zoom.rect.top + zoom.rect.height / 2 - height / 2), vh - height - 8)
  return createPortal(
    <div className="pt-zoom" style={{ left, top, width: WIDTH, maxHeight: height }} role="tooltip">
      <img src={`${import.meta.env.BASE_URL}${thumbOf(card.image)}`} alt="" draggable={false} />
      <div className="pt-zoom-text">
        <b>{card.displayName}</b>
        <span>
          {card.type}{card.color ? ` · ${card.color}` : ''}{card.cost !== null ? ` · coste ${card.cost}` : ''}{card.power !== null ? ` · poder ${card.power}` : ''}
        </span>
        <p>{card.rules || 'Sin texto de reglas.'}</p>
      </div>
    </div>,
    document.body,
  )
}

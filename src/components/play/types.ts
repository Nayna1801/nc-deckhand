import type { PlayOption } from '../../lib/play'
import type { Drop, Ref } from '../../lib/playTable'
import type { HoverFn } from './TCard'

/** Todo lo que cada mitad de la mesa necesita saber del estado de la interfaz y cómo avisar de lo que hace la persona. */
export interface TableUI {
  mySeat: 0 | 1
  options: PlayOption[] // opciones de la pregunta actual
  sel: Ref | null // carta seleccionada (sus acciones salen abajo a la derecha)
  can: Set<string> // cartas con las que se puede hacer algo
  cand: Set<string> // cartas entre las que hay que elegir (objetivo, bloqueador)
  pay: { active: boolean; chosen: number[] } // al pagar: Legends marcadas (posición en la lista de Legends)
  drag: Ref | null // lo que se está arrastrando
  call: { label: string; index: number }[] // Call: acción de la zona de Legends
  busy: boolean
  onSelect: (r: Ref | null) => void
  onPickCandidate: (r: Ref) => void
  onTogglePay: (legendIndex: number) => void
  onChoose: (index: number) => void
  setDrag: (d: Ref | null) => void
  onDrop: (d: Drop) => void
  isDropOk: (d: Drop) => boolean
  onHover: HoverFn
}

import type { PlayOption } from '../../lib/play'
import type { Drop, PayMarks, Ref } from '../../lib/playTable'
import type { HoverFn } from './TCard'

/** Todo lo que cada mitad de la mesa necesita saber del estado de la interfaz y cómo avisar de lo que hace la persona. */
export interface TableUI {
  mySeat: 0 | 1
  options: PlayOption[] // opciones de la pregunta actual
  sel: Ref | null // carta seleccionada (sus acciones salen abajo a la derecha)
  can: Set<string> // cartas con las que se puede hacer algo
  cand: Set<string> // cartas entre las que hay que elegir (objetivo, bloqueador)
  pickOnTap: boolean // un clic en una de esas cartas la elige (objetivos); si no, solo la selecciona y sus jugadas salen en el panel
  /** Al pagar: lo marcado, las Legends con las que se puede pagar y cuántos Eddies sueltos caben. */
  pay: { active: boolean; marks: PayMarks; legs: Set<number>; eddies: number }
  drag: Ref | null // lo que se está arrastrando
  call: { label: string; index: number }[] // Call: acción de la zona de Legends
  busy: boolean
  onSelect: (r: Ref | null) => void
  onPickCandidate: (r: Ref) => void
  onTogglePay: (kind: 'l' | 'e', index: number) => void
  onChoose: (index: number) => void
  onTrash: (side: 0 | 1) => void // abre la lista de cartas de esa basura
  setDrag: (d: Ref | null) => void
  onDrop: (d: Drop) => void
  isDropOk: (d: Drop) => boolean
  onHover: HoverFn
}

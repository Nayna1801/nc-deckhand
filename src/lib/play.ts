/**
 * Partida en vivo contra el piloto del simulador (tools/deckforge: live.py). Aquí solo hay tipos, el cliente HTTP y funciones puras;
 * el dibujo está en components/PlayBoard.tsx y components/PlayPanel.tsx. Solo existe con `npm run dev` (scripts/lab-api.mjs).
 */
import { isTurnHeader, whoOf, type ReplayCardInfo, type ReplayGame, type ReplayState } from './replay'

export interface DeckOption {
  key: string
  group: string
  name: string
  legends: string[]
  main: string[]
}

/** Dónde está algo en el tablero: z = h (mano), f (Unidad en mesa), l (Legend), lz (zona de Legends), g (Gigs); side = asiento. */
export interface Ref {
  z: string
  side?: number
  id?: string
  i?: number
}

/** Una jugada u opción entre las que ofrece el motor; la respuesta es su posición en la lista. */
export interface PlayOption {
  label: string
  group?: string
  card?: string
  cost?: number
  die?: number
  value?: number
  tgt?: string | null
  src?: Ref // de qué carta, Unidad o Legend sale la acción (sin src: es general, como terminar el turno)
  to?: Ref // adónde va (un ataque: la Unidad rival o los Gigs)
  ref?: Ref // al elegir un objetivo: a qué carta del tablero corresponde la opción
  legs?: number[] // al pagar: qué Legends se gastan
  eddies?: number // al pagar: cuántos Eddies sueltos se gastan
}

export interface PlayAsk {
  type: 'ask'
  n: number // número de la pregunta: la respuesta debe llevarlo
  kind: string // mulligan, die, action, target, dice, steal, react, pump
  prompt: string
  me: 0 | 1 // asiento de quien juega (0 = empieza)
  turn: number
  options: PlayOption[]
  extra?: { need?: number } // datos de algunas preguntas: al pagar, cuántos € hay que pagar
  log: string[] // líneas nuevas de la consola desde la pregunta anterior
  view: ReplayState // tablero tal como lo ve quien juega: sin la mano rival ni sus Legends boca abajo desconocidas
  cards?: Record<string, ReplayCardInfo> // solo en la primera pregunta
  names?: [string, string] // [mi mazo, mazo rival]
  seed?: number
}

export interface PlayEnd {
  type: 'end'
  winner: number
  won: boolean
  me: 0 | 1
  log: string[]
  game: ReplayGame // partida completa con las manos de los dos, para repasarla
  cards: Record<string, ReplayCardInfo>
  saved: string | null // fichero con todas las decisiones tomadas
}

export type PlayMessage = PlayAsk | PlayEnd | { type: 'error'; message: string } | { type: 'aborted' }

/** Orden y título de los grupos de opciones; los que no están aquí van detrás con su propio nombre. */
const GROUPS: [string, string][] = [
  ['vender', 'Vender una carta (+1 €)'],
  ['jugar', 'Jugar una carta'],
  ['legend', 'Legends'],
  ['habilidad', 'Habilidades'],
  ['atacar', 'Atacar'],
  ['bloquear', 'Bloquear'],
  ['reaccion', 'Responder'],
  ['refuerzo', 'Reforzar el ataque'],
  ['objetivo', 'Objetivo'],
  ['modo', 'Efecto'],
  ['dado', 'Dados'],
  ['fin', ''],
]
const GROUP_RANK = new Map(GROUPS.map(([g], i) => [g, i]))
const GROUP_TITLE = new Map(GROUPS)

export interface OptionGroup {
  group: string
  title: string
  items: { option: PlayOption; index: number }[]
}

/** Agrupa las opciones conservando su posición original (la respuesta al motor es esa posición). */
export function groupOptions(options: PlayOption[]): OptionGroup[] {
  const by = new Map<string, OptionGroup>()
  options.forEach((option, index) => {
    const group = option.group ?? 'otros'
    let g = by.get(group)
    if (!g) {
      g = { group, title: GROUP_TITLE.get(group) ?? group, items: [] }
      by.set(group, g)
    }
    g.items.push({ option, index })
  })
  const rank = (g: string) => GROUP_RANK.get(g) ?? GROUPS.length - 1.5 // lo desconocido va justo antes de «terminar»
  return [...by.values()].sort((a, b) => rank(a.group) - rank(b.group))
}

/** Jugador (1 o 2) al que le toca, según el último inicio de turno de la consola; 0 si aún no ha empezado ninguno. */
export function currentPlayer(lines: string[]): 0 | 1 | 2 {
  for (let i = lines.length - 1; i >= 0; i--) if (isTurnHeader(lines[i])) return whoOf(lines[i])
  return 0
}

/** Mensajes de fin de partida desde el punto de vista de quien juega. */
export function resultText(end: PlayEnd): string {
  if (end.winner < 0) return 'Empate'
  return end.won ? 'Has ganado' : 'Ha ganado el piloto'
}

/** Envía una orden a la partida en vivo y devuelve el siguiente mensaje. Lanza si el servidor de desarrollo falla. */
export async function playCommand(cmd: Record<string, unknown>): Promise<PlayMessage> {
  const res = await fetch('/__lab/play', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status} del simulador`)
  return data as unknown as PlayMessage
}

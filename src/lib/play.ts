/**
 * Partida en vivo contra el piloto del simulador (tools/deckforge: live.py). Aquí solo hay tipos y funciones puras; el dibujo está
 * en components/PlayBoard.tsx y components/PlayPanel.tsx y la conexión con el motor en lib/labEngine.ts.
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
  kind: string // mulligan, die, action, pick, target, dice, steal, react, pump, pay
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
  warnings?: string[] // solo en la primera pregunta: mazos que no cumplen las reglas de construcción
}

export interface PlayEnd {
  type: 'end'
  winner: number
  won: boolean
  me: 0 | 1
  log: string[]
  game: ReplayGame // partida completa con las manos de los dos, para repasarla
  cards: Record<string, ReplayCardInfo>
  saved: string | null // fichero con todas las decisiones tomadas (solo con el Python del equipo: en el navegador no hay disco)
  record?: Record<string, unknown> | null // decisiones tomadas y lo que habría hecho el piloto (lo que va en `saved`, sin la partida)
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

/**
 * Preguntas que se contestan como el turno normal: tocando una carta para ver sus acciones o arrastrándola. `pick` es el segundo paso
 * de una habilidad ya activada (River Ward: «elige el Gear que juegas gratis»), con una opción para dejarla sin usar.
 */
export const isActionLike = (kind: string): boolean => kind === 'action' || kind === 'pick'

/**
 * ¿Un clic en una carta resaltada la elige directamente? Sí cuando solo se está eligiendo un objetivo. Al defender o reforzar un ataque
 * no: ahí cada carta resaltada es una jugada (bloquear, una habilidad que se gasta) y un clic sin querer no debe ejecutarla; el clic la
 * selecciona y sus jugadas salen en el panel.
 */
export const picksOnTap = (kind: string): boolean => kind !== 'react' && kind !== 'pump'

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

const two = (n: number) => String(n).padStart(2, '0')

/**
 * Fichero con el registro de una partida terminada, igual que los que el Python del equipo guarda en tools/deckforge/data/human/
 * (mismo nombre y contenido: sirve para `forge.py humanlog`). null si no hubo decisiones que guardar.
 */
export function recordFile(end: PlayEnd, now: Date): { name: string; text: string } | null {
  if (!end.record) return null
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  return { name: `${stamp}_seed${end.game.seed}.json`, text: JSON.stringify({ ...end.record, game: end.game }) }
}

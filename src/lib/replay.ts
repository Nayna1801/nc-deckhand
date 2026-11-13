/**
 * Partidas simuladas grabadas paso a paso por tools/deckforge (replay.py). Cada paso es una línea de texto del motor más
 * una foto del tablero en ese momento. Aquí solo hay tipos y funciones puras; el dibujo está en components/ReplayBoard.tsx.
 */

/** [id, poder actual, preparada, con Lag, ids de Gear, entró por Go Solo] (los booleanos son 0/1). */
export type ReplayUnit = [string, number, number, number, string[], number]
/** [id (null = boca abajo y desconocida para quien mira), boca arriba, preparada, retirada del juego, ids de Gear] */
export type ReplayLegend = [string | null, number, number, number, string[]]

export interface ReplayPlayer {
  h: (string | null)[] // mano (null = carta oculta: la mano del rival en una partida en vivo)
  f: ReplayUnit[] // Unidades en mesa
  l: ReplayLegend[] // zona de Legends
  e: [number, number] // Eddies sueltos [totales, preparados] (sin contar las Legends)
  g: [number, number, number][] // Gigs: [máximo del dado, valor, dueño original (0 = J1, 1 = J2)]; el dueño no cambia si el dado se roba
  x: number[] // dados que aún están en el fixer (por su máximo)
  d: number // cartas en el mazo
  t: number // cartas en la basura
}

export interface ReplayState {
  n: number // turno global
  p: [ReplayPlayer, ReplayPlayer]
}

export interface ReplayGame {
  title: string
  a: string // nombre del mazo de J1 (el que empieza)
  b: string // nombre del mazo de J2
  seed: number
  winner: number // 0 = J1, 1 = J2, -1 = empate
  turns: number
  steps: [string, number][] // [texto, índice en states]
  states: ReplayState[]
}

export interface ReplayCardInfo {
  n: string
  t: string
  c: string | null
  k: number | null
  p: number | null
  s: number // vendible
  r: string
}

export interface SimulateResponse {
  game: ReplayGame
  cards: Record<string, ReplayCardInfo>
}

export interface Eddies {
  ready: number
  total: number
  loose: number
  legends: number
}

/**
 * Eddies de un jugador como los enseña el simulador oficial: los Eddies sueltos (por vender cartas) MÁS 1 por cada Legend
 * de la zona de Legends que siga en el juego (cada Legend se puede gastar como 1 €). Al empezar, con 0 vendidas, son 3/3.
 */
export function eddiesOf(p: ReplayPlayer): Eddies {
  const inPlay = p.l.filter((l) => !l[3])
  return { loose: p.e[0], legends: inPlay.length, total: p.e[0] + inPlay.length, ready: p.e[1] + inPlay.filter((l) => l[2]).length }
}

/** Dueño original de un Gig (0 o 1): los grabados antes de que se anotara el dueño se asignan a quien los tiene. */
export const dieOwner = (die: [number, number, number?], holder: number): number => die[2] ?? holder

/** Línea de consola que habla de un dado (tirada, cambio de valor, robo o intercambio). */
export const isDiceLine = (line: string): boolean => line.trimStart().startsWith('⚄')

/** Street Cred = suma de los valores de los Gigs. */
export const streetCred = (p: ReplayPlayer): number => p.g.reduce((a, g) => a + g[1], 0)

/** Jugador al que se refiere una línea de la consola (1 o 2), o 0 si no es de ninguno. */
export function whoOf(line: string): 0 | 1 | 2 {
  const m = /^\s*(?:T\d+ )?J(\d)/.exec(line)
  return m && (m[1] === '1' || m[1] === '2') ? (Number(m[1]) as 1 | 2) : 0
}

export const isTurnHeader = (line: string): boolean => /^T\d+ J\d/.test(line)
export const isEnd = (line: string): boolean => line.startsWith('FIN')

/** Clases de color de una línea de la consola: inicio de turno, fin, dados o jugador al que se refiere (j1 / j2). */
export function lineKinds(line: string): string[] {
  const w = whoOf(line)
  const kinds: string[] = []
  if (isTurnHeader(line)) kinds.push('turn')
  if (isEnd(line)) kinds.push('end')
  if (isDiceLine(line)) kinds.push('dice')
  else if (!isTurnHeader(line) && w) kinds.push(`j${w}`)
  return kinds
}

/** Texto de una línea: la de inicio de turno se resume; `banner` quita el número de turno (ya sale al lado). */
export function stepLabel(line: string, banner = false): string {
  const m = /^T(\d+) J(\d)/.exec(line)
  if (m) return banner ? `Empieza el turno de J${m[2]}` : `Turno ${m[1]} · empieza J${m[2]}`
  return line.trim()
}

/** Cuántas copias de cada carta hay en cada zona (mano o mesa) de cada jugador: sirve para marcar las que acaban de aparecer. */
export function zoneCounts(s: ReplayState): Map<string, number> {
  const m = new Map<string, number>()
  const add = (k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  s.p.forEach((p, i) => {
    p.h.forEach((id) => id !== null && add(`${i}|h|${id}`))
    p.f.forEach((u) => add(`${i}|f|${u[0]}`))
  })
  return m
}

/** Escoge la 'n'-ésima copia de una carta en una zona: es nueva si hay más copias ahora que en el paso anterior. */
export function isNewCopy(prev: Map<string, number> | null, key: string, nth: number): boolean {
  return prev ? nth > (prev.get(key) ?? 0) : false
}

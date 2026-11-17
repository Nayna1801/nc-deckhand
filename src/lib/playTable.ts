/**
 * Lógica de la mesa de juego (sin dibujo): qué opciones pertenecen a qué carta, qué se puede arrastrar y adónde, y cómo se paga.
 * El motor etiqueta cada opción con `src` (de dónde sale), `to` (adónde va) y `ref` (qué carta del tablero elige); aquí se usan.
 */
import type { PlayOption, Ref } from './play'

export type { Ref }

/** Dónde se suelta una carta arrastrada. */
export type Drop = { z: 'field' } | { z: 'eddies' } | { z: 'unit'; side: number; i: number } | { z: 'legend'; side: number; i: number } | { z: 'gigs'; side: number }

export interface Indexed {
  option: PlayOption
  index: number // posición en la lista original: es lo que se le responde al motor
}

export const refKey = (r: Ref): string => `${r.z}:${r.side ?? ''}:${r.id ?? r.i ?? ''}`
export const sameRef = (a?: Ref | null, b?: Ref | null): boolean => !!a && !!b && refKey(a) === refKey(b)

const indexed = (options: PlayOption[]): Indexed[] => options.map((option, index) => ({ option, index }))

/** Opciones de la carta, Unidad o Legend seleccionada. */
export const optionsFor = (options: PlayOption[], sel: Ref | null): Indexed[] => (sel ? indexed(options).filter((o) => sameRef(o.option.src, sel)) : [])

/** Opciones de una zona entera (el Call es de la zona de Legends: `lz`). */
export const zoneOptions = (options: PlayOption[], z: string): Indexed[] => indexed(options).filter((o) => o.option.src?.z === z)

/** Opciones generales, que no salen de ninguna carta (terminar el turno...). */
export const globalOptions = (options: PlayOption[]): Indexed[] => indexed(options).filter((o) => !o.option.src)

/** Una entrada del menú de una carta: una acción directa, o una acción con subacciones que solo se listan al abrirla. */
export type MenuEntry =
  | { kind: 'direct'; index: number; label: string }
  | { kind: 'sub'; key: string; title: string; items: { index: number; label: string; to?: Ref }[] }

const SUB_TITLES: Record<string, string> = { jugar: 'Jugar', vender: 'Vender', legend: 'Legend', habilidad: 'Habilidades', atacar: 'Atacar' }
const afterArrow = (label: string): string => (label.includes('→') ? label.slice(label.indexOf('→') + 1).trim() : label)

/**
 * Menú de la carta seleccionada, en dos niveles para que se vea ordenado: primero qué quieres hacer y, si eso tiene variantes, después
 * cuál. Atacar: «a los Gigs» es directa y «a una Unidad…» abre la lista de Unidades rivales (aunque solo haya una: nada se elige solo).
 * Cualquier otro tipo de acción con más de una opción (varias habilidades de la misma carta) se agrupa igual.
 */
export function cardMenu(options: Indexed[]): MenuEntry[] {
  const out: MenuEntry[] = []
  const subs = new Map<string, Extract<MenuEntry, { kind: 'sub' }>>()
  const count = new Map<string, number>()
  for (const o of options) count.set(o.option.group ?? '', (count.get(o.option.group ?? '') ?? 0) + 1)
  for (const { option, index } of options) {
    const group = option.group ?? ''
    const unitAttack = group === 'atacar' && option.to?.z === 'f'
    if (!unitAttack && (group === 'atacar' || (count.get(group) ?? 0) < 2)) {
      out.push({ kind: 'direct', index, label: option.label })
      continue
    }
    const key = unitAttack ? 'atacar-unidad' : group
    let sub = subs.get(key)
    if (!sub) {
      sub = { kind: 'sub', key, title: unitAttack ? 'Atacar a una Unidad' : (SUB_TITLES[group] ?? group), items: [] }
      subs.set(key, sub)
      out.push(sub)
    }
    sub.items.push({ index, label: unitAttack ? afterArrow(option.label) : option.label, to: option.to })
  }
  return out
}

/** Claves de las cartas con las que se puede hacer algo ahora (para resaltarlas). */
export const actorKeys = (options: PlayOption[]): Set<string> =>
  new Set(options.flatMap((o) => (o.src && o.src.z !== 'lz' ? [refKey(o.src)] : [])))

/** Claves de las cartas entre las que hay que elegir un objetivo, un bloqueador... */
export const candidateKeys = (options: PlayOption[]): Set<string> => new Set(options.flatMap((o) => (o.ref ? [refKey(o.ref)] : [])))

/** La opción que se elige al tocar esa carta del tablero (objetivo, bloqueador...). */
export const optionForRef = (options: PlayOption[], ref: Ref): Indexed | null => indexed(options).find((o) => sameRef(o.option.ref, ref)) ?? null

/**
 * La opción que se ejecuta al soltar `drag` en `drop`, o null si no vale:
 *  mano → mesa = jugar · mano → Eddies = vender · mano → una de tus Unidades o Legends boca arriba = jugar (el Gear se equipa a esa;
 *  quien dibuja la mesa solo acepta Gear sobre una Legend) ·
 *  Unidad → Gigs rivales = atacar los Gigs · Unidad → Unidad rival = atacarla · Legend boca arriba → mesa = Go Solo.
 */
export function dropOption(options: PlayOption[], drag: Ref, drop: Drop): Indexed | null {
  const mine = indexed(options).filter((o) => sameRef(o.option.src, drag))
  const pick = (group: string, ok: (o: PlayOption) => boolean = () => true) => mine.find((o) => o.option.group === group && ok(o.option)) ?? null
  if (drag.z === 'h') {
    if (drop.z === 'eddies') return pick('vender')
    if (drop.z === 'field' || ((drop.z === 'unit' || drop.z === 'legend') && drop.side === drag.side)) return pick('jugar')
  } else if (drag.z === 'f') {
    if (drop.z === 'gigs' && drop.side !== drag.side) return pick('atacar', (o) => o.to?.z === 'g')
    if (drop.z === 'unit' && drop.side !== drag.side) return pick('atacar', (o) => o.to?.z === 'f' && o.to.i === drop.i)
  } else if (drag.z === 'l' && drop.z === 'field') {
    return pick('legend')
  }
  return null
}

export const canDrop = (options: PlayOption[], drag: Ref, drop: Drop): boolean => dropOption(options, drag, drop) !== null

/** Opción de pago que corresponde a un conjunto de Legends marcadas (los Eddies sueltos completan el resto), o null si no hay. */
export function payOption(options: PlayOption[], chosen: number[]): number | null {
  const key = [...chosen].sort((a, b) => a - b).join(',')
  const i = options.findIndex((o) => o.legs && [...o.legs].sort((a, b) => a - b).join(',') === key)
  return i < 0 ? null : i
}

/** Con qué se puede pagar: las Legends que salen en alguna opción y cuántos Eddies sueltos caben como mucho. */
export function payLimits(options: PlayOption[]): { legs: Set<number>; eddies: number } {
  return { legs: new Set(options.flatMap((o) => o.legs ?? [])), eddies: Math.max(0, ...options.map((o) => o.eddies ?? 0)) }
}

export interface PayMarks {
  legs: number[] // Legends marcadas (posición en la zona de Legends)
  eddies: number[] // Eddies sueltos marcados (posición en la fila; no se distinguen entre sí: solo cuenta cuántos)
}

/**
 * Marca o desmarca una Legend o un Eddie para pagar `need` €. No deja marcar lo que no vale (una Legend que no puede pagar, más Eddies de
 * los que hay preparados) ni pasarse del precio. Devuelve las marcas nuevas (las mismas si el toque no vale).
 */
export function togglePay(options: PlayOption[], marks: PayMarks, kind: 'l' | 'e', i: number, need: number): PayMarks {
  const list = kind === 'l' ? marks.legs : marks.eddies
  if (list.includes(i)) return kind === 'l' ? { ...marks, legs: list.filter((x) => x !== i) } : { ...marks, eddies: list.filter((x) => x !== i) }
  const limits = payLimits(options)
  if (marks.legs.length + marks.eddies.length >= need) return marks
  if (kind === 'l' ? !limits.legs.has(i) : marks.eddies.length >= limits.eddies) return marks
  return kind === 'l' ? { ...marks, legs: [...list, i] } : { ...marks, eddies: [...list, i] }
}

/** La opción que paga justo con lo marcado, o null si aún falta por marcar (o esa combinación no existe). */
export function payPick(options: PlayOption[], marks: PayMarks, need: number): number | null {
  if (marks.legs.length + marks.eddies.length !== need) return null
  const i = payOption(options, marks.legs)
  return i !== null && (options[i].eddies ?? 0) === marks.eddies.length ? i : null
}

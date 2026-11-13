/**
 * Lógica de la mesa de juego (sin dibujo): qué opciones pertenecen a qué carta, qué se puede arrastrar y adónde, y cómo se paga.
 * El motor etiqueta cada opción con `src` (de dónde sale), `to` (adónde va) y `ref` (qué carta del tablero elige); aquí se usan.
 */
import type { PlayOption, Ref } from './play'

export type { Ref }

/** Dónde se suelta una carta arrastrada. */
export type Drop = { z: 'field' } | { z: 'eddies' } | { z: 'unit'; side: number; i: number } | { z: 'gigs'; side: number }

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

/** Claves de las cartas con las que se puede hacer algo ahora (para resaltarlas). */
export const actorKeys = (options: PlayOption[]): Set<string> =>
  new Set(options.flatMap((o) => (o.src && o.src.z !== 'lz' ? [refKey(o.src)] : [])))

/** Claves de las cartas entre las que hay que elegir un objetivo, un bloqueador... */
export const candidateKeys = (options: PlayOption[]): Set<string> => new Set(options.flatMap((o) => (o.ref ? [refKey(o.ref)] : [])))

/** La opción que se elige al tocar esa carta del tablero (objetivo, bloqueador...). */
export const optionForRef = (options: PlayOption[], ref: Ref): Indexed | null => indexed(options).find((o) => sameRef(o.option.ref, ref)) ?? null

/**
 * La opción que se ejecuta al soltar `drag` en `drop`, o null si no vale:
 *  mano → mesa = jugar · mano → Eddies = vender · mano → una de tus Unidades = jugar (el Gear se equipa a esa) ·
 *  Unidad → Gigs rivales = atacar los Gigs · Unidad → Unidad rival = atacarla · Legend boca arriba → mesa = Go Solo.
 */
export function dropOption(options: PlayOption[], drag: Ref, drop: Drop): Indexed | null {
  const mine = indexed(options).filter((o) => sameRef(o.option.src, drag))
  const pick = (group: string, ok: (o: PlayOption) => boolean = () => true) => mine.find((o) => o.option.group === group && ok(o.option)) ?? null
  if (drag.z === 'h') {
    if (drop.z === 'eddies') return pick('vender')
    if (drop.z === 'field' || (drop.z === 'unit' && drop.side === drag.side)) return pick('jugar')
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

/** Texto de lo que falta o sobra al pagar con las Legends marcadas: «Faltan 1 €», «Con 2 Eddies sueltos», etc. */
export function payHint(options: PlayOption[], chosen: number[], need: number, loose: number): string {
  const spend = need - chosen.length
  if (spend < 0) return `Sobran ${-spend} Legends: solo se pagan ${need} €`
  if (spend > loose) return `Faltan ${spend - loose} €: marca más Legends`
  return payOption(options, chosen) === null ? 'Esa combinación no es posible' : `${chosen.length} Legends + ${spend} Eddies sueltos`
}

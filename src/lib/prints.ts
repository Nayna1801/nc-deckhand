import { compareBySetAndNumber, normalizeText, setIndex } from './catalog'
import type { Card, Printing } from './types'

/**
 * De dónde sale la imagen que se muestra para una impresión:
 * - `exact`: tenemos la imagen de esa impresión (la original o un arte alternativo del mismo set y número).
 * - `original`: es una reimpresión con la mismo ilustrador que la original, así que se usa su imagen.
 * - `likely`: no tenemos su imagen, pero otro arte de la carta es del mismo ilustrador y probablemente es el mismo.
 * - `unknown`: ilustrador distinto y sin imagen disponible; se muestra la original como referencia.
 */
export type ArtSource = 'exact' | 'original' | 'likely' | 'unknown'

/** Una impresión concreta de una carta (un set y un número de coleccionista). */
export interface PrintEntry {
  /** Clave estable: carta + set + número. */
  key: string
  card: Card
  /** Nombre del set sin sufijo de idioma. */
  setName: string
  setCode: string
  collectorNumber: string | null
  edition: string | null
  artist: string | null
  /** Ruta de la imagen dentro de /public. */
  image: string
  art: ArtSource
  /** Posición del arte alternativo correspondiente en `card.altArts`; -1 si no hay. */
  altIndex: number
  /**
   * Clave del arte propio que se cuenta en el inventario (ver `variantsOf`); null si es el diseño base de la
   * carta, que cuenta junto con el resto de impresiones base (da igual si es Beta o Retail).
   */
  variantKey: string | null
  /** Es la impresión principal (la que define la carta en el catálogo). */
  isOriginal: boolean
  hasFrench: boolean
}

/** Clave de un arte alternativo: su id dentro de la carta (único por carta). */
export const altKey = (a: { id: string }): string => `alt:${a.id}`

/** Clave de una impresión con diseño propio de la que no tenemos arte alternativo catalogado. */
export const printKey = (p: { setCode: string; collectorNumber: string | null }): string => `print:${p.setCode.toLowerCase()}#${p.collectorNumber ?? ''}`

/** Grupo de los artes alternativos que el catálogo no asocia a ningún set. */
export const NO_SET = 'Artes alternativos sin set'

const sameSet = (a: string | null, b: string | null): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** Compara ilustradores tolerando mayúsculas, acentos y el plural ("Bad Moon Studio" = "Bad Moon Studios"). */
const artistKey = (name: string | null): string => normalizeText(name ?? '').replace(/ /g, '').replace(/s$/, '')

export function printsOf(card: Card): PrintEntry[] {
  const original = card.printings.find((p) => p.isPrimary) ?? card.printings[0]
  const seen = new Set<string>()
  const out: PrintEntry[] = []
  const hasFrench = card.printings.some((p) => p.language === 'fr')

  for (const p of card.printings) {
    if (p.language !== 'en') continue
    const dedupe = `${p.baseSetName}#${p.collectorNumber ?? ''}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    out.push(toEntry(card, p, original, hasFrench))
  }
  // artes alternativos que no corresponden a ninguna impresión (p. ej. «Alt Art» o «Alpha Art» sin set): también se pueden coleccionar
  const covered = new Set(out.map((e) => e.variantKey))
  card.altArts.forEach((a, i) => {
    if (covered.has(altKey(a)) || !a.image) return
    out.push({
      key: `${card.id}@${a.baseSetName ?? NO_SET}#${a.id}`,
      card,
      setName: a.baseSetName ?? NO_SET,
      setCode: a.setCode ?? '',
      collectorNumber: a.collectorNumber,
      edition: a.edition,
      artist: a.artist,
      image: a.image,
      art: 'exact',
      altIndex: i,
      variantKey: altKey(a),
      isOriginal: false,
      hasFrench,
    })
  })
  // las entradas del catálogo siempre incluyen la impresión principal; si faltara, la carta no desaparece
  if (out.length === 0) {
    out.push({
      key: `${card.id}@${card.setCode}#${card.printNumber ?? ''}`,
      card,
      setName: card.setName,
      setCode: card.setCode,
      collectorNumber: card.printNumber,
      edition: null,
      artist: card.artist,
      image: card.image,
      art: 'exact',
      altIndex: -1,
      variantKey: null,
      isOriginal: true,
      hasFrench,
    })
  }
  return out
}

function toEntry(card: Card, p: Printing, original: Printing | undefined, hasFrench: boolean): PrintEntry {
  const base = {
    key: `${card.id}@${p.baseSetName}#${p.collectorNumber ?? ''}`,
    card,
    setName: p.baseSetName,
    setCode: p.setCode,
    collectorNumber: p.collectorNumber,
    edition: p.edition,
    artist: p.artist,
    isOriginal: p.isPrimary,
    hasFrench,
  }
  const matched = card.altArts.findIndex((a) => sameSet(a.setCode, p.setCode) && a.collectorNumber === p.collectorNumber)
  const matchedArt = matched >= 0 ? card.altArts[matched] : undefined
  if (matchedArt?.image) return { ...base, image: matchedArt.image, art: 'exact', altIndex: matched, variantKey: altKey(matchedArt) }
  if (p.isPrimary) return { ...base, image: card.image, art: 'exact', altIndex: -1, variantKey: null }

  const altIndex = matched
  if (!p.artist || !original?.artist || artistKey(p.artist) === artistKey(original.artist)) {
    return { ...base, image: card.image, art: 'original', altIndex, variantKey: null }
  }
  // otro ilustrador: es un diseño distinto del base aunque no tengamos su imagen exacta
  const similar = card.altArts.findIndex((a) => a.image && artistKey(a.artist) === artistKey(p.artist))
  if (similar >= 0) return { ...base, image: card.altArts[similar].image as string, art: 'likely', altIndex: similar, variantKey: printKey(p) }
  return { ...base, image: card.image, art: 'unknown', altIndex, variantKey: printKey(p) }
}

/** Todas las impresiones (en inglés) de una lista de cartas, en el orden de las cartas. */
export function buildPrints(cards: Card[]): PrintEntry[] {
  return cards.flatMap(printsOf)
}

const numberOf = (e: PrintEntry): number => parseInt((e.collectorNumber ?? '').replace(/\D/g, ''), 10) || 0

/** Orden de los sets al listar impresiones: los del catálogo principal primero y el resto por nombre. */
const setRank = (e: PrintEntry): number => setIndex({ setCode: e.setCode.toLowerCase() })

export function compareBySet(a: PrintEntry, b: PrintEntry): number {
  return (
    setRank(a) - setRank(b) ||
    a.setName.localeCompare(b.setName) ||
    numberOf(a) - numberOf(b) ||
    (a.collectorNumber ?? '').localeCompare(b.collectorNumber ?? '') ||
    compareBySetAndNumber(a.card, b.card)
  )
}

/**
 * Pasa de las cartas filtradas a sus impresiones. Con orden "set y número" se agrupan por set; con otro
 * orden se respeta el de las cartas (y sus impresiones quedan juntas). Si hay sets elegidos, solo se
 * dejan las impresiones de esos sets: así buscar «Set 1 Promos» muestra las cartas de ese set, no sus versiones base.
 */
export function expandPrints(cards: Card[], opts: { sets?: string[]; bySet: boolean }): PrintEntry[] {
  const sets = opts.sets ?? []
  const all = buildPrints(cards).filter((e) => sets.length === 0 || sets.includes(e.setName))
  return opts.bySet ? all.sort(compareBySet) : all
}

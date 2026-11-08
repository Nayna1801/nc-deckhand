import { CARDS } from '../config.mjs'

/**
 * Cifras esperadas calculadas desde src/data/cards.json (no a mano): así las pruebas no se rompen cada vez
 * que se completa el catálogo, y siguen comprobando que la pantalla coincide con los datos.
 */
export const N = CARDS.length
export const count = (f) => CARDS.filter(f).length

const sameCode = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase()

/** Impresiones (set + número) en inglés de una carta, más sus artes con imagen que no pertenecen a ninguna impresión. */
export function printsOf(c) {
  const seen = new Map()
  for (const p of c.printings) {
    if (p.language !== 'en') continue
    const key = `${p.baseSetName}#${p.collectorNumber ?? ''}`
    if (!seen.has(key)) seen.set(key, { setName: p.baseSetName, number: p.collectorNumber, setCode: p.setCode })
  }
  const en = [...seen.values()]
  const extra = c.altArts
    .filter((a) => a.image && !en.some((p) => sameCode(p.setCode, a.setCode) && p.number === a.collectorNumber))
    .map((a) => ({ setName: a.baseSetName ?? 'Artes alternativos sin set', number: a.collectorNumber, setCode: a.setCode ?? '' }))
  return [...en, ...extra]
}

export const ALL_PRINTS = CARDS.flatMap((c) => printsOf(c).map((p) => ({ ...p, cardId: c.id })))
export const P_TOTAL = ALL_PRINTS.length
export const P_BY_SET = ALL_PRINTS.reduce((m, p) => m.set(p.setName, (m.get(p.setName) ?? 0) + 1), new Map())
export const P_GROUPS = P_BY_SET.size
/** Sets distintos del selector (los idiomas de un mismo set cuentan una vez). */
export const SETS_N = new Set(CARDS.flatMap((c) => c.printings.map((p) => p.baseSetName))).size
/** Artes alternativos con imagen: uno contable por cada uno. */
export const ALTS = CARDS.reduce((a, c) => a + c.altArts.filter((x) => x.image).length, 0)
/**
 * Impresiones Pre-Release (Beta y Retail): llevan marca de promoción, así que cuentan como diseño propio aunque no
 * tengan arte alternativo catalogado. En «Por impresión» con «Solo artes alternativos» salen todas.
 */
export const PRERELEASE_PRINTS = CARDS.reduce((n, c) => n + printsOf(c).filter((p) => /pre-?release/i.test(p.setName) && !c.altArts.some((a) => a.image && sameCode(a.setCode, p.setCode) && a.collectorNumber === p.number)).length, 0)
/** Fichas de «Por impresión» con «Solo artes alternativos y promos»: artes con imagen + Pre-Release. */
export const ART_PRINTS = ALTS + PRERELEASE_PRINTS
/** Páginas de la lista de Cartas y fichas de la última. */
export const pagesOf = (total, size = 48) => ({ pages: Math.max(1, Math.ceil(total / size)), last: total - size * (Math.max(1, Math.ceil(total / size)) - 1) })

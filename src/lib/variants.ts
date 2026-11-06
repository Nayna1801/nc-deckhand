import { altKey, printsOf } from './prints'
import { catalog } from './catalog'
import type { AltArt, Card } from './types'

/** Un arte alternativo o promo con diseño propio, que el inventario cuenta por separado del diseño base. */
export interface Variant {
  /** Clave con la que se guarda en `InventoryEntry.arts`. */
  key: string
  label: string
  /** Set, número e ilustrador, para distinguirlo de otros artes de la misma carta. */
  detail: string
  /** Ruta de la imagen dentro de /public. */
  image: string
  /** La imagen no es exactamente la de este arte (no la tenemos): se usa la de la carta o una parecida. */
  approx: boolean
}

export const altLabel = (a: AltArt): string => [a.rarity, a.label].filter(Boolean).join(' · ') || 'Arte alternativo'

const cache = new Map<string, Variant[]>()

/**
 * Artes que se cuentan por separado en una carta: cada arte alternativo del catálogo (Iconic, Nova, Alpha,
 * promos…) más las impresiones con otro ilustrador de las que no tenemos arte catalogado. El diseño base no
 * es una variante: se cuenta con las copias normales, sea de la edición Beta o de la Retail.
 */
export function variantsOf(card: Card): Variant[] {
  const hit = cache.get(card.id)
  if (hit) return hit
  const out: Variant[] = card.altArts.map((a) => ({
    key: altKey(a),
    label: altLabel(a),
    detail: [a.baseSetName, a.collectorNumber && `#${a.collectorNumber}`, a.artist].filter(Boolean).join(' · '),
    image: a.image ?? card.image,
    approx: !a.image,
  }))
  const seen = new Set(out.map((v) => v.key))
  for (const p of printsOf(card)) {
    if (!p.variantKey || seen.has(p.variantKey)) continue
    seen.add(p.variantKey)
    out.push({
      key: p.variantKey,
      label: p.art === 'marked' ? 'Promoción' : 'Otro arte',
      detail: [p.setName, p.collectorNumber && `#${p.collectorNumber}`, p.artist].filter(Boolean).join(' · '),
      image: p.image,
      approx: true,
    })
  }
  cache.set(card.id, out)
  return out
}

/** Cuántos artes distintos se pueden coleccionar en todo el catálogo. */
export const TOTAL_VARIANTS: number = catalog.cards.reduce((n, c) => n + variantsOf(c).length, 0)

import { normalizeCode, normalizeText, type Catalog } from './catalog'
import type { Card, Deck, ParsedDeck, Quantities } from './types'

type Section = 'legend' | 'main' | 'side'

export const MAX_IMPORT_CHARS = 100_000
const MAX_QTY = 99
const MAX_LEGENDS = 3

const LEGEND_RE = /^(legends?|l)$/
const MAIN_RE = /^(main\s+deck|deck|main|m|d|units?|gears?|programs?)$/
const SIDE_RE = /^(side\s*board|side|s)$/

/** Candidatos de un código ambiguo -> el que encaje por nombre; si no, por tipo de sección. */
function disambiguate(candidates: Card[], section: Section, nameHint: string): Card | null {
  const hint = normalizeText(nameHint)
  if (hint) {
    const byName = candidates.filter((c) => {
      const n = normalizeText(c.displayName)
      return hint === n || hint.includes(n) || n.includes(hint)
    })
    if (byName.length === 1) return byName[0]
  }
  const byType = candidates.filter((c) => (section === 'legend' ? c.type === 'Legend' : c.type !== 'Legend'))
  return byType.length === 1 ? byType[0] : null
}

export function parseDeckText(text: string, catalog: Catalog, fallbackName = 'Mazo importado'): ParsedDeck {
  const out: ParsedDeck = { name: fallbackName, legendIds: [], main: {}, side: {}, issues: [], warnings: [] }
  if (text.length > MAX_IMPORT_CHARS) {
    out.issues.push({ line: 0, text: '', reason: `El texto es demasiado grande (máximo ${MAX_IMPORT_CHARS.toLocaleString('es-ES')} caracteres).` })
    return out
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const firstContent = lines.findIndex((l) => l.trim())
  let section: Section = 'main'

  lines.forEach((raw, i) => {
    const line = raw.trim()
    const lineNo = i + 1
    if (!line) return

    if (line.startsWith('#') || line.startsWith('//')) {
      const body = line.replace(/^(\/\/|#)/, '').trim()
      const key = body.toLowerCase().replace(/\s*\(\d+\)$/, '').trim()
      if (LEGEND_RE.test(key)) section = 'legend'
      else if (MAIN_RE.test(key)) section = 'main'
      else if (SIDE_RE.test(key)) section = 'side'
      else if (/^name\s*:/i.test(body)) out.name = body.replace(/^name\s*:/i, '').trim().slice(0, 64) || fallbackName
      else if (i === firstContent && /^#\s+/.test(line)) out.name = body.slice(0, 64) || fallbackName
      return
    }

    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i)
    if (!m) {
      out.issues.push({ line: lineNo, text: line, reason: 'No se entiende la cantidad ni la carta.' })
      return
    }
    const requested = parseInt(m[1], 10)
    const qty = Math.min(requested, MAX_QTY)
    if (requested > MAX_QTY) out.warnings.push(`Línea ${lineNo}: la cantidad ${requested} se limitó a ${MAX_QTY}.`)
    const rest = m[2].trim()
    if (!(qty > 0)) {
      out.issues.push({ line: lineNo, text: line, reason: 'La cantidad debe ser un entero positivo.' })
      return
    }

    // "012 Goro Takemura: Hands Unclean" -> código + nombre; "Goro Takemura: Hands Unclean" -> solo nombre
    const cm = rest.match(/^([A-Za-z0-9-]+)(?:\s+(.*))?$/)
    const codeToken = cm?.[1] ?? ''
    const nameHint = cm?.[2] ?? ''
    let card: Card | null = null

    const byCode = catalog.byCode[normalizeCode(codeToken)] ?? []
    if (byCode.length === 1) card = byCode[0]
    else if (byCode.length > 1) {
      card = disambiguate(byCode, section, nameHint)
      if (!card) {
        out.issues.push({
          line: lineNo,
          text: line,
          reason: `El código "${codeToken}" coincide con varias cartas: ${byCode.map((c) => c.displayName).join(', ')}.`,
        })
        return
      }
    }
    if (!card) {
      const byName = catalog.byName[normalizeText(rest)] ?? []
      if (byName.length === 1) card = byName[0]
      else if (byName.length > 1) {
        out.issues.push({ line: lineNo, text: line, reason: `El nombre "${rest}" es ambiguo, usa el código de la carta.` })
        return
      }
    }
    if (!card) {
      out.issues.push({ line: lineNo, text: line, reason: `Carta desconocida: "${rest}".` })
      return
    }

    if (section === 'legend' || (card.type === 'Legend' && section !== 'side')) {
      for (let k = 0; k < Math.min(qty, MAX_LEGENDS) && out.legendIds.length < MAX_LEGENDS * 2; k++) out.legendIds.push(card.id)
      if (section !== 'legend') out.warnings.push(`Línea ${lineNo}: ${card.displayName} se ha tratado como Legend.`)
      return
    }
    const target = section === 'side' ? out.side : out.main
    target[card.id] = (target[card.id] ?? 0) + qty
  })
  return out
}

const byDisplayName = (catalog: Catalog) => (a: string, b: string) => {
  const ca = catalog.byId[a]
  const cb = catalog.byId[b]
  return (ca?.displayName ?? a).localeCompare(cb?.displayName ?? b) || a.localeCompare(b)
}

const entry = (qty: number, c: Card) => `${qty}x ${c.importId ?? ''} ${c.displayName}`.replace(/\s+/g, ' ')

function lines(q: Quantities, catalog: Catalog): string[] {
  return Object.keys(q)
    .filter((id) => q[id] > 0 && catalog.byId[id])
    .sort(byDisplayName(catalog))
    .map((id) => entry(q[id], catalog.byId[id]))
}

/** Exporta en el mismo formato que el deck builder de cyberpunk-tcg-sim.online. */
export function serializeDeck(deck: Pick<Deck, 'name' | 'legendIds' | 'main' | 'side'>, catalog: Catalog): string {
  const blocks: string[][] = [[`# Name: ${deck.name}`]]
  const legends = [...new Set(deck.legendIds)].sort(byDisplayName(catalog)).filter((id) => catalog.byId[id])
  if (legends.length) blocks.push(['# Legends', ...legends.map((id) => entry(1, catalog.byId[id]))])
  const main = lines(deck.main, catalog)
  if (main.length) blocks.push(['# Main Deck', ...main])
  const side = lines(deck.side, catalog)
  if (side.length) blocks.push(['# Sideboard', ...side])
  return blocks.map((b) => b.join('\n')).join('\n\n')
}

/** Nombre como lo escribe melee.gg: «Nombre | Subnombre» (sin código, sin «x» en la cantidad). */
export const meleeName = (c: Card): string => (c.subname ? `${c.name} | ${c.subname}` : c.name)

const meleeLines = (q: Quantities, catalog: Catalog): string[] =>
  Object.keys(q)
    .filter((id) => q[id] > 0 && catalog.byId[id])
    .sort(byDisplayName(catalog))
    .map((id) => `${q[id]} ${meleeName(catalog.byId[id])}`)

/** Exporta para pegar en melee.gg: secciones «// Legends», «// Main Deck» y «// Sideboard». */
export function serializeDeckMelee(deck: Pick<Deck, 'legendIds' | 'main' | 'side'>, catalog: Catalog): string {
  const blocks: string[][] = []
  const legends = [...new Set(deck.legendIds)].sort(byDisplayName(catalog)).filter((id) => catalog.byId[id])
  if (legends.length) blocks.push(['// Legends', ...legends.map((id) => `1 ${meleeName(catalog.byId[id])}`)])
  const main = meleeLines(deck.main, catalog)
  if (main.length) blocks.push(['// Main Deck', ...main])
  const side = meleeLines(deck.side, catalog)
  if (side.length) blocks.push(['// Sideboard', ...side])
  return blocks.map((b) => b.join('\n')).join('\n\n')
}

/** Lista plana de cartas (colección, deseos, compra) con nombres al estilo melee.gg. */
export function serializeCardsMelee(q: Quantities, catalog: Catalog): string {
  return meleeLines(q, catalog).join('\n')
}

/** Colección: mismo formato de líneas, en una sola sección. */
export function serializeCollection(col: Quantities, catalog: Catalog): string {
  return ['# Collection', ...lines(col, catalog)].join('\n')
}

export function parseCollectionText(text: string, catalog: Catalog): { collection: Quantities; issues: ParsedDeck['issues'] } {
  const p = parseDeckText(text, catalog)
  const collection: Quantities = {}
  const add = (id: string, n: number) => (collection[id] = (collection[id] ?? 0) + n)
  p.legendIds.forEach((id) => add(id, 1))
  Object.entries(p.main).forEach(([id, n]) => add(id, n))
  Object.entries(p.side).forEach(([id, n]) => add(id, n))
  return { collection, issues: p.issues }
}

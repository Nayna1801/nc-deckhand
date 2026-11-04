import { COLORS, normalizeText, RARITIES, TYPES } from './catalog'
import type { Card } from './types'

/**
 * Búsqueda con sintaxis tipo Scryfall / ripperdeck:
 *   t:unit c:red cost<=2 o:"draw"      -t:legend      t:legend or t:gear
 * Los valores son SIEMPRE texto literal (nunca regex ni código).
 */

type Pred = (c: Card) => boolean
type Op = ':' | '=' | '!=' | '<' | '<=' | '>' | '>='

export interface FieldDoc {
  aliases: string[]
  description: string
  example: string
}

export const SEARCH_FIELDS: FieldDoc[] = [
  { aliases: ['t', 'type'], description: 'Tipo: legend, unit, gear, program', example: 't:unit' },
  { aliases: ['c', 'color'], description: 'Color: red, yellow, blue, green (o r, y, b, g)', example: 'c:red' },
  { aliases: ['r', 'rarity'], description: 'Rareza de la carta', example: 'r:rare' },
  { aliases: ['cost'], description: 'Coste en eddies (admite < <= > >= !=)', example: 'cost<=2' },
  { aliases: ['power', 'pow'], description: 'Poder de ataque (admite < <= > >= !=)', example: 'power>=10' },
  { aliases: ['ram'], description: 'RAM que aporta o requiere', example: 'ram:2' },
  { aliases: ['o', 'text', 'rules'], description: 'Texto de reglas', example: 'o:"draw 1"' },
  { aliases: ['name'], description: 'Solo en el nombre', example: 'name:saul' },
  { aliases: ['k', 'kw', 'keyword', 'when'], description: 'Keyword o disparador: blocker, go solo, adrenaline, quick, play, attack, call, defeated, spend', example: 'k:blocker' },
  { aliases: ['f', 'faction', 'trait'], description: 'Facción o clasificación', example: 'f:arasaka' },
  { aliases: ['a', 'artist'], description: 'Artista (de cualquier impresión)', example: 'a:"Daniel Valaisis"' },
  { aliases: ['s', 'set'], description: 'Set donde se imprimió (cualquier impresión)', example: 's:beta' },
  { aliases: ['num', 'number'], description: 'Número de coleccionista (cualquier impresión)', example: 'num:012' },
  { aliases: ['lang', 'language'], description: 'Idioma de alguna impresión: en, fr', example: 'lang:fr' },
  { aliases: ['has'], description: 'Variantes: alt (arte alternativo), fr, promo, variants', example: 'has:alt' },
  { aliases: ['alt', 'altart'], description: 'Arte alternativo por rareza o nombre (nova, iconic…)', example: 'alt:nova' },
  { aliases: ['legal', 'legality'], description: 'Legalidad en Standard', example: 'legal:legal' },
]

export const SEARCH_NOTES = [
  'Varias condiciones se combinan con AND. Usa "or" para alternativas: t:legend or t:gear',
  'Un guion niega: -t:legend. Las comillas agrupan frases: o:"draw 1"',
]

export const SEARCH_EXAMPLES = ['t:unit c:red cost<=2 o:"draw"', 'k:blocker or k:"go solo"', 's:beta -t:legend', 'has:alt', 'lang:fr']

export interface Search {
  match: Pred
  errors: string[]
  /** true si no hay ninguna condición efectiva (devuelve todas las cartas). */
  isEmpty: boolean
}

/* ---------- tokenizado ---------- */

const MAX_TOKENS = 5000

/** Divide por espacios respetando comillas; unas comillas sin cerrar abarcan hasta el final. */
function tokenize(q: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of q) {
    if (ch === '"') {
      quoted = !quoted
      cur += ch
    } else if (/\s/.test(ch) && !quoted) {
      if (cur) out.push(cur)
      cur = ''
    } else cur += ch
    if (out.length >= MAX_TOKENS) break
  }
  if (cur && out.length < MAX_TOKENS) out.push(cur)
  return out
}

const unquote = (v: string): string => v.replace(/"/g, '').trim()

/* ---------- ayudas de coincidencia ---------- */

const rawLower = (s: string): string => s.toLowerCase()

/** Coincidencia literal: normaliza acentos/símbolos; si el texto buscado es solo símbolos, compara tal cual. */
function containsText(hay: string, needle: string): boolean {
  const n = normalizeText(needle)
  if (n) return normalizeText(hay).includes(n)
  return needle.length > 0 && rawLower(hay).includes(rawLower(needle))
}

const hayCache = new WeakMap<Card, { norm: string; raw: string }>()
function hayOf(c: Card): { norm: string; raw: string } {
  let h = hayCache.get(c)
  if (!h) {
    const raw = [c.displayName, c.rules, c.classifications.join(' '), c.importId ?? ''].join(' ')
    h = { norm: normalizeText(raw), raw: rawLower(raw) }
    hayCache.set(c, h)
  }
  return h
}

function bareTerm(needle: string): Pred {
  const n = normalizeText(needle)
  const raw = rawLower(needle)
  return (c) => (n ? hayOf(c).norm.includes(n) : raw.length > 0 && hayOf(c).raw.includes(raw))
}

const keyOf = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const stripZeros = (s: string): string => s.trim().toLowerCase().replace(/^0+(?=[0-9a-z])/, '')

export function keywordsOf(c: Card): Set<string> {
  const out = new Set<string>()
  for (const m of c.rules.matchAll(/\{([^}]+)\}/g)) out.add(keyOf(m[1]))
  return out
}

/** Resuelve un valor contra una lista cerrada: exacto, o prefijo único. */
function resolveEnum(value: string, options: readonly string[]): string | 'ambiguous' | null {
  const v = value.toLowerCase()
  const exact = options.find((o) => o.toLowerCase() === v)
  if (exact) return exact
  const pref = options.filter((o) => o.toLowerCase().startsWith(v))
  if (pref.length === 1) return pref[0]
  return pref.length > 1 ? 'ambiguous' : null
}

/* ---------- compilación de cada término ---------- */

type Compiled = { pred: Pred } | { error: string }

const NUMERIC: Record<string, (c: Card) => number | null> = {
  cost: (c) => c.cost,
  power: (c) => c.power,
  pow: (c) => c.power,
  ram: (c) => c.ram,
}

function compareNumber(op: Op, actual: number, wanted: number): boolean {
  switch (op) {
    case ':':
    case '=':
      return actual === wanted
    case '!=':
      return actual !== wanted
    case '<':
      return actual < wanted
    case '<=':
      return actual <= wanted
    case '>':
      return actual > wanted
    case '>=':
      return actual >= wanted
  }
}

const bySetText = (c: Card, v: string): boolean =>
  containsText(`${c.setName} ${c.setCode}`, v) ||
  c.printings.some((p) => containsText(`${p.baseSetName} ${p.setName} ${p.setCode}`, v)) ||
  c.altArts.some((a) => containsText(`${a.baseSetName ?? ''} ${a.setCode ?? ''}`, v))

function compile(field: string, op: Op, value: string): Compiled {
  const f = field.toLowerCase()
  if (!value) return { error: `«${field}${op}» necesita un valor` }

  if (f in NUMERIC) {
    if (!/^\d+$/.test(value)) return { error: `«${field}» espera un número (recibido «${value}»)` }
    const wanted = parseInt(value, 10)
    const get = NUMERIC[f]
    return { pred: (c) => { const a = get(c); return a != null && compareNumber(op, a, wanted) } }
  }

  // los campos de texto solo admiten : = !=
  if (op === '<' || op === '<=' || op === '>' || op === '>=') return { error: `El operador ${op} solo sirve con cost, power y ram (no con «${field}»)` }
  const negate = op === '!='
  const wrap = (p: Pred): Compiled => ({ pred: negate ? (c) => !p(c) : p })

  switch (f) {
    case 't':
    case 'type': {
      const r = resolveEnum(value, TYPES)
      if (r === null || r === 'ambiguous') return { error: `Tipo desconocido «${value}» (usa ${TYPES.join(', ')})` }
      return wrap((c) => c.type === r)
    }
    case 'c':
    case 'color': {
      const r = resolveEnum(value, COLORS)
      if (r === null || r === 'ambiguous') return { error: `Color desconocido «${value}» (usa ${COLORS.join(', ')})` }
      return wrap((c) => c.color === r)
    }
    case 'r':
    case 'rarity': {
      const r = resolveEnum(value, RARITIES)
      if (r === null || r === 'ambiguous') return { error: `Rareza desconocida «${value}» (usa ${RARITIES.join(', ')})` }
      return wrap((c) => c.rarity === r)
    }
    case 'o':
    case 'text':
    case 'rules':
      return wrap((c) => containsText(c.rules, value))
    case 'name':
      return wrap((c) => containsText(c.displayName, value))
    case 'k':
    case 'kw':
    case 'keyword':
    case 'when': {
      const key = keyOf(value)
      if (!key) return { error: `«${field}» necesita una keyword válida` }
      return wrap((c) => keywordsOf(c).has(key))
    }
    case 'f':
    case 'faction':
    case 'trait':
      return wrap((c) => c.classifications.some((x) => containsText(x, value)))
    case 'a':
    case 'artist':
      return wrap(
        (c) =>
          containsText(c.artist ?? '', value) ||
          c.printings.some((p) => containsText(p.artist ?? '', value)) ||
          c.altArts.some((a) => containsText(a.artist ?? '', value)),
      )
    case 's':
    case 'set':
      return wrap((c) => bySetText(c, value))
    case 'num':
    case 'number': {
      const want = stripZeros(value)
      return wrap(
        (c) =>
          stripZeros(c.importId ?? '') === want ||
          c.printings.some((p) => stripZeros(p.collectorNumber ?? '') === want) ||
          c.altArts.some((a) => stripZeros(a.collectorNumber ?? '') === want),
      )
    }
    case 'lang':
    case 'language': {
      const l = value.toLowerCase()
      const code = ['en', 'english', 'ingles', 'inglés'].includes(l) ? 'en' : ['fr', 'french', 'frances', 'francés'].includes(l) ? 'fr' : null
      if (!code) return { error: `Idioma desconocido «${value}» (usa en o fr)` }
      return wrap((c) => c.printings.some((p) => p.language === code))
    }
    case 'has': {
      const h = value.toLowerCase()
      if (h === 'alt' || h === 'altart') return wrap((c) => c.altArts.length > 0)
      if (h === 'fr') return wrap((c) => c.printings.some((p) => p.language === 'fr'))
      if (h === 'promo') return wrap((c) => c.printings.some((p) => /promo/i.test(`${p.baseSetName} ${p.edition}`)))
      if (h === 'variants') return wrap((c) => new Set(c.printings.map((p) => p.baseSetName)).size > 1 || c.altArts.length > 0)
      return { error: `«has:${value}» no existe (usa alt, fr, promo o variants)` }
    }
    case 'alt':
    case 'altart':
      return wrap((c) => c.altArts.some((a) => containsText([a.rarity, a.label].filter(Boolean).join(' '), value)))
    case 'legal':
    case 'legality': {
      const l = value.toLowerCase()
      return wrap((c) => c.legality.toLowerCase().startsWith(l))
    }
    default:
      return { error: `Campo desconocido «${field}»` }
  }
}

/* ---------- parser ---------- */

const TERM_RE = /^([A-Za-z]+)(!=|<=|>=|:|=|<|>)(.*)$/

export function parseSearch(query: string): Search {
  const errors: string[] = []
  const groups: Pred[][] = [[]]

  for (const raw of tokenize(query ?? '')) {
    if (raw.toLowerCase() === 'or') {
      if (groups[groups.length - 1].length > 0) groups.push([])
      continue
    }
    let tok = raw
    let negated = false
    if (tok.length > 1 && tok.startsWith('-')) {
      negated = true
      tok = tok.slice(1)
    }

    const m = tok.match(TERM_RE)
    let pred: Pred | null = null
    if (m) {
      const [, field, op, rest] = m
      const value = unquote(rest)
      const known = SEARCH_FIELDS.some((d) => d.aliases.includes(field.toLowerCase())) || field.toLowerCase() in NUMERIC
      if (!known && (value === '' || !/^[:=]$/.test(op))) {
        // "Takemura:" (nombre con dos puntos) o comparaciones sobre campos inexistentes
        if (value === '' && op === ':') pred = bareTerm(unquote(field))
        else errors.push(`Campo desconocido «${field}»`)
      } else {
        const r = compile(field, op as Op, value)
        if ('error' in r) errors.push(r.error)
        else pred = r.pred
      }
    } else {
      const text = unquote(tok)
      if (text) pred = bareTerm(text)
    }

    if (pred) {
      const p = pred
      groups[groups.length - 1].push(negated ? (c) => !p(c) : p)
    }
  }

  const active = groups.filter((g) => g.length > 0)
  return {
    errors,
    isEmpty: active.length === 0,
    match: active.length === 0 ? () => true : (c) => active.some((g) => g.every((p) => p(c))),
  }
}

// Completa src/data/cards.json con impresiones, artes y cartas que el catálogo base no trae
// (promos, ediciones Beta, Judge…), a partir de listados por set YA descargados en una carpeta local.
// Este script NO hace peticiones de red.
//
//   node scripts/merge-official-prints.mjs --from <carpeta>           informe + plan de descargas (<carpeta>/plan.json)
//   node scripts/merge-official-prints.mjs --from <carpeta> --apply   aplica (necesita <carpeta>/images/<printing_id>.webp)
//
// <carpeta> contiene set_<codigo>.json = { total, items: [...] } con las cartas de cada set y, en cada una,
// la lista `printings` con todas sus impresiones. Es idempotente: se puede repetir tras `npm run sync`.
//
// Una impresión necesita imagen propia si es de otro ilustrador que la original o de un set promocional
// (Judge, Promos); las reimpresiones normales con la misma ilustración se cuentan con el diseño base.
import { copyFile, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const value = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)
const from = value('--from')
const apply = flag('--apply')
if (!from) {
  console.error('Falta --from <carpeta con los set_*.json>')
  process.exit(1)
}

const CARDS = join(root, 'src/data/cards.json')
const exists = (p) => access(p).then(() => true, () => false)

const normalize = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
const artistKey = (s) => normalize(s).replace(/ /g, '').replace(/s$/, '')
const PROMO_SET = /promo|judge/i
const fixText = (s) => (typeof s === 'string' ? s.replace(/â€”/g, '—').replace(/â€“/g, '–') : s)
const edition = (code) => (/beta/i.test(code) ? 'beta' : /retail/i.test(code) ? 'retail' : 'other')
const slugNum = (n) => String(n ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const printKey = (code, num) => `${String(code).toLowerCase()}|${num ?? ''}`

const cards = JSON.parse(await readFile(CARDS, 'utf8'))
const byName = new Map(cards.map((c) => [normalize(c.displayName), c]))

// ---- listados descargados: una entrada por carta con todas sus impresiones en inglés ----
const official = new Map() // nombre normalizado -> { item, prints: Map }
for (const f of readdirSync(from).filter((n) => /^set_.*\.json$/.test(n))) {
  const { items } = JSON.parse(await readFile(join(from, f), 'utf8'))
  for (const it of items) {
    const k = normalize(it.display_name)
    const e = official.get(k) ?? { item: it, prints: new Map() }
    for (const p of it.printings ?? []) {
      if (p.language !== 'en') continue
      e.prints.set(printKey(p.set.code, p.collector_number), p)
    }
    official.set(k, e)
  }
}

const plan = { newCards: [], newPrintings: [], downloads: [] }

for (const [k, { item, prints }] of official) {
  const ours = byName.get(k)
  const list = [...prints.values()]
  if (list.length === 0) continue

  if (!ours) {
    const primary = list.find((p) => p.id === item.printing_id) ?? list[0]
    plan.newCards.push({ name: item.display_name, id: normalizeId(item), item, primary, prints: list })
    plan.downloads.push({ printingId: primary.id, url: primary.image_url, dest: `cards/${normalizeId(item)}.webp`, why: `carta nueva ${item.display_name}` })
    for (const p of list) {
      if (p.id === primary.id) continue
      if (needsImage(p, primary.artist, null)) plan.downloads.push({ printingId: p.id, url: p.image_url, dest: `cards/alt/${normalizeId(item)}__${altId(p)}.webp`, why: `arte de ${item.display_name}` })
    }
    continue
  }

  const original = ours.printings.find((p) => p.isPrimary) ?? ours.printings[0]
  for (const p of list) {
    const key = printKey(p.set.code, p.collector_number)
    const known = ours.printings.some((x) => x.language === 'en' && printKey(x.setCode, x.collectorNumber) === key)
    if (!known) plan.newPrintings.push({ cardId: ours.id, key, set: p.set.name, number: p.collector_number })
    const hasImage = ours.altArts.some((a) => a.image && printKey(a.setCode ?? '', a.collectorNumber) === key)
    const isOriginal = original && printKey(original.setCode, original.collectorNumber) === key
    if (!isOriginal && !hasImage && needsImage(p, original?.artist ?? ours.artist, ours)) {
      plan.downloads.push({ printingId: p.id, url: p.image_url, dest: `cards/alt/${ours.id}__${altId(p)}.webp`, why: `${ours.displayName} ${p.set.name} #${p.collector_number}` })
    }
  }
}

function normalizeId(item) {
  return normalize(item.display_name).replace(/ /g, '_')
}
function altId(p) {
  return `${String(p.set.code).toLowerCase()}_${slugNum(p.collector_number)}`
}
function needsImage(p, originalArtist) {
  return PROMO_SET.test(p.set.name) || (!!p.artist && !!originalArtist && artistKey(p.artist) !== artistKey(originalArtist))
}

const uniqueDownloads = [...new Map(plan.downloads.map((d) => [d.dest, d])).values()]
console.log(`cartas nuevas: ${plan.newCards.length} (${plan.newCards.map((c) => c.name).join(', ')})`)
console.log(`impresiones que no teníamos: ${plan.newPrintings.length}`)
console.log(`imágenes a descargar: ${uniqueDownloads.length}`)

if (!apply) {
  await writeFile(join(from, 'plan.json'), JSON.stringify({ downloads: uniqueDownloads }, null, 1))
  console.log(`plan escrito en ${join(from, 'plan.json')}`)
  process.exit(0)
}

// ---- aplicar: copiar imágenes y completar cards.json ----
const missing = []
for (const d of uniqueDownloads) if (!(await exists(join(from, 'images', `${d.printingId}.webp`)))) missing.push(d.dest)
if (missing.length) {
  console.error(`faltan ${missing.length} imágenes descargadas (p. ej. ${missing[0]}); no se aplica nada`)
  process.exit(2)
}
for (const d of uniqueDownloads) {
  const dest = join(root, 'public', d.dest)
  await mkdir(dirname(dest), { recursive: true })
  await copyFile(join(from, 'images', `${d.printingId}.webp`), dest)
}

const toPrinting = (p, isPrimary) => ({
  setCode: p.set.code,
  setName: fixText(p.set.name),
  baseSetName: fixText(p.set.name),
  edition: edition(p.set.code),
  collectorNumber: p.collector_number ?? null,
  language: 'en',
  artist: p.artist ?? null,
  finish: p.finish ?? null,
  isPrimary,
})
const toAlt = (p, ownerId, primaryArtist) => ({
  id: altId(p),
  label: PROMO_SET.test(p.set.name) ? `Promo ${p.collector_number}` : `${/^iconic/i.test(p.rarity ?? '') ? 'Iconic ' : ''}Alt Art ${p.collector_number}`,
  collectorNumber: p.collector_number ?? null,
  artist: p.artist ?? null,
  rarity: p.rarity ?? null,
  finish: p.finish ?? null,
  setCode: p.set.code,
  setName: fixText(p.set.name),
  baseSetName: fixText(p.set.name),
  edition: edition(p.set.code),
  image: `cards/alt/${ownerId}__${altId(p)}.webp`,
})
const downloaded = new Set(uniqueDownloads.map((d) => d.dest))

let addedPrintings = 0
let addedAlts = 0
for (const [k, { prints }] of official) {
  const ours = byName.get(k)
  if (!ours) continue
  const original = ours.printings.find((p) => p.isPrimary) ?? ours.printings[0]
  for (const p of prints.values()) {
    const key = printKey(p.set.code, p.collector_number)
    if (!ours.printings.some((x) => x.language === 'en' && printKey(x.setCode, x.collectorNumber) === key)) {
      ours.printings.push(toPrinting(p, false))
      addedPrintings++
    }
    const dest = `cards/alt/${ours.id}__${altId(p)}.webp`
    if (downloaded.has(dest) && !ours.altArts.some((a) => a.image === dest)) {
      ours.altArts.push(toAlt(p, ours.id, original?.artist))
      addedAlts++
    }
  }
}

let addedCards = 0
for (const nc of plan.newCards) {
  const it = nc.item
  const prim = nc.primary
  const card = {
    id: nc.id,
    name: it.name,
    subname: it.subname ?? null,
    displayName: it.display_name,
    type: it.card_type,
    color: it.color ?? null,
    cost: it.cost ?? null,
    power: it.power ?? null,
    ram: it.ram ?? null,
    rarity: prim.rarity ?? it.rarity ?? null,
    setCode: prim.set.code,
    setName: fixText(prim.set.name),
    printNumber: prim.collector_number ?? null,
    importId: null,
    rules: it.rules_text ?? '',
    flavor: it.flavor_text ?? null,
    artist: prim.artist ?? it.artist ?? null,
    classifications: it.classifications ?? [],
    keywords: it.keywords ?? [],
    legality: it.legality ?? 'unknown',
    isAlpha: false,
    printings: [toPrinting(prim, true)],
    altArts: [],
    image: `cards/${nc.id}.webp`,
  }
  for (const p of nc.prints) {
    if (p.id === prim.id) continue
    card.printings.push(toPrinting(p, false))
    const dest = `cards/alt/${nc.id}__${altId(p)}.webp`
    if (downloaded.has(dest)) card.altArts.push(toAlt(p, nc.id, prim.artist))
  }
  if (!byName.has(normalize(card.displayName)) && !cards.some((c) => c.id === card.id)) {
    cards.push(card)
    addedCards++
  }
}

await writeFile(CARDS, JSON.stringify(cards, null, 1) + '\n')
console.log(`aplicado: ${addedCards} cartas, ${addedPrintings} impresiones, ${addedAlts} artes alternativos, ${uniqueDownloads.length} imágenes`)

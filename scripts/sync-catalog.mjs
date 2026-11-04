// Sincroniza el catálogo de cartas desde cyberpunk-tcg-sim.online.
//  - Descarga /api/cards/catalog (mismo JSON que usa su deck builder)
//  - Normaliza los campos que necesitamos a src/data/cards.json
//  - Descarga las imágenes a public/cards/<id>.webp (solo las que falten)
//
// Uso:  npm run sync            (catálogo + imágenes nuevas)
//       npm run sync -- --force (re-descarga todas las imágenes)
import { mkdir, writeFile, access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ORIGIN = 'https://cyberpunk-tcg-sim.online'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const force = process.argv.includes('--force')
const CONCURRENCY = 6

// --from <fichero>  usa un catálogo ya descargado (sin peticiones de red); implica no descargar imágenes
// --no-images       solo regenera src/data/cards.json
const fromIdx = process.argv.indexOf('--from')
const fromFile = fromIdx > -1 ? process.argv[fromIdx + 1] : null
const skipImages = process.argv.includes('--no-images') || fromFile !== null
// --alt-images       descarga también las imágenes de los artes alternativos (public/cards/alt)
// --alt-dir <dir>    carpeta de destino de esas imágenes (por defecto public/cards/alt)
const altImages = process.argv.includes('--alt-images')
const altDirIdx = process.argv.indexOf('--alt-dir')
const ALT_DIR = altDirIdx > -1 ? process.argv[altDirIdx + 1] : null
const ALT_CONCURRENCY = 2 // pocas peticiones a la vez: son archivos grandes de un servidor ajeno

const exists = (p) => access(p).then(() => true, () => false)

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.json()
}

// El JSON viene con mojibake en "—" en algunos nombres de set (UTF-8 leído como latin1).
const fixText = (s) => (typeof s === 'string' ? s.replace(/â€”/g, '—').replace(/â€“/g, '–') : s)

/** "Welcome to Night City — Retail — FR" -> "Welcome to Night City — Retail" */
const baseSetName = (name) => fixText(name ?? '').replace(/\s+—\s+(FR|French)$/i, '').trim()
const isFrench = (setCode, setName) => /-fr$/i.test(setCode ?? '') || /\s—\s(FR|French)$/i.test(fixText(setName ?? ''))

function normalizePrinting(p) {
  return {
    setCode: p.set_code,
    setName: fixText(p.set_name),
    baseSetName: baseSetName(p.set_name),
    edition: p.edition ?? null,
    collectorNumber: p.collector_number ?? null,
    language: isFrench(p.set_code, p.set_name) ? 'fr' : 'en',
    artist: p.artist ?? null,
    finish: p.finish ?? null,
    isPrimary: p.is_primary === true,
  }
}

/** Nombre base (sin extensión) único y seguro para una imagen de arte alternativo. */
const altBase = (a, cardId) =>
  (a.image_file ? a.image_file.split('/').pop().replace(/\.[a-z0-9]+$/i, '') : `${cardId}__${a.id}`).replace(/[^\w.-]/g, '_')

/** Formato real de una imagen según sus primeros bytes (la extensión que da el origen no es fiable). */
function imageExt(buf) {
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg'
  return null
}

function normalizeAltArt(a, cardId) {
  return {
    _base: altBase(a, cardId),
    _url: a.image_url ?? null,
    _path: a.image_file ?? null,
    id: a.id,
    label: a.label ?? null,
    collectorNumber: a.collector_number ?? null,
    artist: a.artist ?? null,
    rarity: a.rarity ?? null,
    finish: a.finish ?? null,
    setCode: a.set_code ?? null,
    setName: a.set_name ? fixText(a.set_name) : null,
    baseSetName: a.set_name ? baseSetName(a.set_name) : null,
    edition: a.edition ?? null,
  }
}

function normalize(c) {
  return {
    id: c.id,
    name: c.name,
    subname: c.subname ?? null,
    displayName: c.display_name ?? c.name,
    type: c.card_type,
    color: c.color ?? null,
    cost: Number.isFinite(c.cost) ? c.cost : null,
    power: Number.isFinite(c.power) ? c.power : null,
    ram: Number.isFinite(c.ram) ? c.ram : null,
    rarity: c.rarity ?? null,
    setCode: c.set_code,
    setName: fixText(c.set_name),
    printNumber: c.print_number ?? null,
    importId: c.import_id ?? c.print_number ?? null,
    rules: c.rules_text ?? '',
    flavor: c.flavor_text ?? null,
    artist: c.artist ?? null,
    classifications: c.classifications ?? [],
    keywords: c.keywords ?? [],
    legality: c.legality ?? 'legal',
    isAlpha: c.is_alpha === true || c.set_code === 'alpha',
    printings: (c.source?.printings ?? []).map(normalizePrinting),
    altArts: (c.alt_arts ?? []).map((a) => normalizeAltArt(a, c.id)),
    // rutas de origen: solo se usan en este script, no se guardan en cards.json
    _imageUrl: c.assets?.image_url ?? null,
    _imageRemote: c.assets?.image_remote ?? null,
  }
}

async function downloadImage(card) {
  const dest = join(root, 'public', 'cards', `${card.id}.webp`)
  if (!force && (await exists(dest))) return 'skip'
  const candidates = [card._imageUrl && `${ORIGIN}${card._imageUrl}`, card._imageRemote].filter(Boolean)
  for (const url of candidates) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      await writeFile(dest, Buffer.from(await res.arrayBuffer()))
      return 'ok'
    } catch {
      /* probamos la siguiente fuente */
    }
  }
  return 'fail'
}

const altDir = ALT_DIR ?? join(root, 'public', 'cards', 'alt')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const EXTS = ['webp', 'png', 'jpg']

/** Fichero ya descargado para ese nombre base, con la extensión que tenga. */
async function findAltFile(base) {
  for (const e of EXTS) if (await exists(join(altDir, `${base}.${e}`))) return `${base}.${e}`
  return null
}

/** Descarga la imagen de un arte alternativo: primero /media (como hace la propia web), luego la ruta del fichero. */
async function downloadAlt(a) {
  if (!force && (await findAltFile(a._base))) return 'skip'
  const candidates = [a._url && `${ORIGIN}${a._url}`, a._path && `${ORIGIN}/${a._path.replace(/^\/+/, '')}`].filter(Boolean)
  for (const url of candidates) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      const ext = imageExt(buf)
      if (!ext || buf.byteLength < 1000) continue // no es una imagen (p. ej. una página de error): se descarta
      await writeFile(join(altDir, `${a._base}.${ext}`), buf)
      return 'ok'
    } catch {
      /* probamos la siguiente fuente */
    }
  }
  return 'fail'
}

async function main() {
  const catalog = fromFile ? JSON.parse(await readFile(fromFile, 'utf8')) : (console.log('Descargando catálogo…'), await getJson(`${ORIGIN}/api/cards/catalog`))
  const raw = catalog.cards
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('Catálogo vacío')
  if (catalog.cardCount !== undefined && catalog.cardCount !== raw.length) {
    throw new Error(`Catálogo incompleto: esperadas ${catalog.cardCount}, recibidas ${raw.length}`)
  }

  const cards = raw.map(normalize).sort((a, b) => a.setCode.localeCompare(b.setCode) || a.id.localeCompare(b.id))
  await mkdir(join(root, 'public', 'cards'), { recursive: true })

  const stats = { ok: 0, skip: 0, fail: 0 }
  const failed = []
  let next = 0
  async function worker() {
    while (next < cards.length) {
      const card = cards[next++]
      const r = skipImages ? 'skip' : await downloadImage(card)
      stats[r]++
      if (r === 'fail') failed.push(card.id)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  // imágenes de artes alternativos (opcional): pocas peticiones a la vez y con una pausa entre cada una
  const altStats = { ok: 0, skip: 0, fail: 0 }
  const altFailed = []
  if (altImages) {
    await mkdir(altDir, { recursive: true })
    const alts = cards.flatMap((c) => c.altArts.map((a) => ({ a, cardId: c.id })))
    let at = 0
    async function altWorker() {
      while (at < alts.length) {
        const { a, cardId } = alts[at++]
        const r = await downloadAlt(a)
        altStats[r]++
        if (r === 'fail') altFailed.push(`${cardId}/${a._base}`)
        if (r === 'ok') await sleep(150)
      }
    }
    await Promise.all(Array.from({ length: ALT_CONCURRENCY }, altWorker))
  }

  // cada arte alternativo apunta a su imagen solo si el fichero existe
  const out = []
  for (const { _imageUrl, _imageRemote, ...c } of cards) {
    const altArts = []
    for (const { _base, _url, _path, ...a } of c.altArts) {
      const file = await findAltFile(_base)
      altArts.push({ ...a, image: file ? `cards/alt/${file}` : null })
    }
    out.push({ ...c, altArts, image: `cards/${c.id}.webp` })
  }

  if (ALT_DIR) {
    console.log('(modo prueba: --alt-dir indicado, no se escribe src/data/cards.json)')
  } else {
    await mkdir(join(root, 'src', 'data'), { recursive: true })
    await writeFile(join(root, 'src', 'data', 'cards.json'), JSON.stringify(out, null, 1) + '\n')
  }

  console.log(`Cartas: ${out.length} · imágenes nuevas: ${stats.ok} · ya existentes: ${stats.skip} · fallidas: ${stats.fail}`)
  if (altImages) console.log(`Artes alternativos: nuevas ${altStats.ok} · ya existentes ${altStats.skip} · fallidas ${altStats.fail}`)
  if (failed.length || altFailed.length) {
    console.error('Sin imagen:', [...failed, ...altFailed].join(', '))
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

// Sincroniza el catálogo de cartas desde cyberpunk-tcg-sim.online.
//  - Descarga /api/cards/catalog (mismo JSON que usa su deck builder)
//  - Normaliza los campos que necesitamos a src/data/cards.json
//  - Descarga las imágenes a public/cards/<id>.webp (solo las que falten)
//
// Uso:  npm run sync            (catálogo + imágenes nuevas)
//       npm run sync -- --force (re-descarga todas las imágenes)
import { mkdir, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ORIGIN = 'https://cyberpunk-tcg-sim.online'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const force = process.argv.includes('--force')
const CONCURRENCY = 6

const exists = (p) => access(p).then(() => true, () => false)

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.json()
}

// El JSON viene con mojibake en "—" en algunos nombres de set (UTF-8 leído como latin1).
const fixText = (s) => (typeof s === 'string' ? s.replace(/â€”/g, '—').replace(/â€“/g, '–') : s)

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

async function main() {
  console.log('Descargando catálogo…')
  const catalog = await getJson(`${ORIGIN}/api/cards/catalog`)
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
      const r = await downloadImage(card)
      stats[r]++
      if (r === 'fail') failed.push(card.id)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const out = cards.map(({ _imageUrl, _imageRemote, ...c }) => ({ ...c, image: `cards/${c.id}.webp` }))
  await mkdir(join(root, 'src', 'data'), { recursive: true })
  await writeFile(join(root, 'src', 'data', 'cards.json'), JSON.stringify(out, null, 1) + '\n')

  console.log(`Cartas: ${out.length} · imágenes nuevas: ${stats.ok} · ya existentes: ${stats.skip} · fallidas: ${stats.fail}`)
  if (failed.length) {
    console.error('Sin imagen:', failed.join(', '))
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

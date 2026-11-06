import { descriptorFromRGBA, topMatches, type Match } from './descriptor'

/** Una imagen distinta del catálogo: la carta con su diseño base (`art` null) o con un arte alternativo (`alt:<id>`). */
export interface AtlasRef {
  card: string
  art: string | null
  /** Ruta de la imagen completa dentro de /public. */
  image: string
  /** Otras cartas o artes que usan exactamente la misma imagen. */
  also: { card: string; art: string | null }[]
}

interface AtlasFile {
  cell: [number, number]
  cols: number
  refs: AtlasRef[]
}

export interface Atlas {
  refs: AtlasRef[]
  descriptors: Float32Array[]
}

let cached: Promise<Atlas> | null = null

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('No se pudo cargar el atlas de cartas.'))
    img.src = src
  })

/** Descarga el atlas (una sola vez) y calcula la huella de cada carta con la misma receta que se aplica a la foto. */
export function loadAtlas(): Promise<Atlas> {
  cached ??= (async () => {
    const base = import.meta.env.BASE_URL
    const [meta, img] = await Promise.all([
      fetch(`${base}scan/atlas.json`).then((r) => {
        if (!r.ok) throw new Error('No se pudo cargar la lista de cartas del escáner.')
        return r.json() as Promise<AtlasFile>
      }),
      loadImage(`${base}scan/atlas.webp`),
    ])
    const [cw, ch] = meta.cell
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Este navegador no permite leer imágenes.')
    ctx.drawImage(img, 0, 0)
    const descriptors = meta.refs.map((_, i) => {
      const cell = ctx.getImageData((i % meta.cols) * cw, Math.floor(i / meta.cols) * ch, cw, ch)
      return descriptorFromRGBA(cell.data, cw, ch)
    })
    return { refs: meta.refs, descriptors }
  })().catch((e) => {
    cached = null // permite reintentar si falló la descarga
    throw e
  })
  return cached
}

/** Rectángulo centrado con la proporción de una carta (5:7) que ocupa `fraction` del lado menor posible. */
export function guideRect(w: number, h: number, fraction: number): { x: number; y: number; w: number; h: number } {
  const RATIO = 5 / 7
  const gh = Math.min(h * fraction, (w * fraction) / RATIO)
  const gw = gh * RATIO
  return { x: (w - gw) / 2, y: (h - gh) / 2, w: gw, h: gh }
}

/** Tamaño al que se reduce el recorte antes de calcular la huella (suficiente y barato). */
export const CAPTURE_SIZE: [number, number] = [240, 336]

/** Huella de la zona de una imagen o fotograma de vídeo (el recorte se reduce a un lienzo pequeño). */
export function describeRegion(source: CanvasImageSource, rect: { x: number; y: number; w: number; h: number }): Float32Array {
  const canvas = document.createElement('canvas')
  canvas.width = CAPTURE_SIZE[0]
  canvas.height = CAPTURE_SIZE[1]
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Este navegador no permite leer imágenes.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height)
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return descriptorFromRGBA(px.data, canvas.width, canvas.height)
}

export interface Candidate extends Match {
  ref: AtlasRef
}

/**
 * Las `k` cartas más parecidas a una huella. Son cartas DISTINTAS: si varios artes de una misma carta puntúan
 * alto, solo se ofrece el más parecido (los demás artes se eligen luego en el detalle de la carta).
 */
export function findCandidates(atlas: Atlas, query: Float32Array, k = 3): Candidate[] {
  const out: Candidate[] = []
  if (k <= 0) return out
  const seen = new Set<string>()
  for (const m of topMatches(query, atlas.descriptors, atlas.descriptors.length)) {
    const ref = atlas.refs[m.index]
    if (seen.has(ref.card)) continue
    seen.add(ref.card)
    out.push({ ...m, ref })
    if (out.length >= k) break
  }
  return out
}

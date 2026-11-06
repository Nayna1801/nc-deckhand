/**
 * Huella de una carta para reconocerla con la cámara (prototipo).
 *
 * Receta (la que mejor funcionó en las pruebas con fotos simuladas): se descarta un borde del 5 %, el resto se
 * reduce a una rejilla de 12×16 promediando por área, se pasa a color Lab y cada canal se normaliza por separado
 * (media 0, desviación 1) para absorber el brillo, el contraste y el tinte de la foto. Dos cartas se comparan con
 * el coseno de sus huellas.
 */

export const GRID_W = 12
export const GRID_H = 16
export const DESC_LEN = GRID_W * GRID_H * 3
/** Parte de cada lado que se descarta (el marco de la carta y el fondo cercano). */
export const INNER_MARGIN = 0.05

const srgbToLinear = (c: number): number => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

const labF = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)

/** sRGB (0–255) -> Lab (D65). */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883
  const fx = labF(x)
  const fy = labF(y)
  const fz = labF(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** Promedio por área (con bordes fraccionarios) de la zona interior de la imagen sobre una rejilla gw×gh, en RGB. */
export function areaGrid(data: ArrayLike<number>, w: number, h: number, gw: number, gh: number, margin: number = INNER_MARGIN): Float64Array {
  const x0 = w * margin
  const y0 = h * margin
  const cw = (w * (1 - 2 * margin)) / gw
  const ch = (h * (1 - 2 * margin)) / gh
  const out = new Float64Array(gw * gh * 3)
  for (let gy = 0; gy < gh; gy++) {
    const ya = y0 + gy * ch
    const yb = ya + ch
    for (let gx = 0; gx < gw; gx++) {
      const xa = x0 + gx * cw
      const xb = xa + cw
      let sr = 0
      let sg = 0
      let sb = 0
      let sw = 0
      for (let y = Math.floor(ya); y < Math.min(h, Math.ceil(yb)); y++) {
        const wy = Math.min(y + 1, yb) - Math.max(y, ya)
        if (wy <= 0) continue
        for (let x = Math.floor(xa); x < Math.min(w, Math.ceil(xb)); x++) {
          const wx = Math.min(x + 1, xb) - Math.max(x, xa)
          if (wx <= 0) continue
          const wgt = wx * wy
          const i = (y * w + x) * 4
          sr += data[i] * wgt
          sg += data[i + 1] * wgt
          sb += data[i + 2] * wgt
          sw += wgt
        }
      }
      const o = (gy * gw + gx) * 3
      if (sw > 0) {
        out[o] = sr / sw
        out[o + 1] = sg / sw
        out[o + 2] = sb / sw
      }
    }
  }
  return out
}

/** Huella (vector unitario de 576 números) de una imagen RGBA de cualquier tamaño. */
export function descriptorFromRGBA(data: ArrayLike<number>, w: number, h: number): Float32Array {
  const cells = GRID_W * GRID_H
  const rgb = areaGrid(data, w, h, GRID_W, GRID_H)
  const chan = [new Float64Array(cells), new Float64Array(cells), new Float64Array(cells)]
  for (let i = 0; i < cells; i++) {
    const [L, a, b] = rgbToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])
    chan[0][i] = L
    chan[1][i] = a
    chan[2][i] = b
  }
  const out = new Float32Array(DESC_LEN)
  let norm = 0
  for (let c = 0; c < 3; c++) {
    let mean = 0
    for (let i = 0; i < cells; i++) mean += chan[c][i]
    mean /= cells
    let varSum = 0
    for (let i = 0; i < cells; i++) varSum += (chan[c][i] - mean) ** 2
    const std = Math.sqrt(varSum / cells)
    for (let i = 0; i < cells; i++) {
      const v = (chan[c][i] - mean) / (std + 1e-6)
      out[c * cells + i] = v
      norm += v * v
    }
  }
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < DESC_LEN; i++) out[i] /= norm
  return out
}

/** Parecido entre dos huellas (coseno; 1 = idénticas). */
export function similarity(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

export interface Match {
  index: number
  score: number
}

/** Las `k` referencias más parecidas, de mayor a menor parecido. */
export function topMatches(query: Float32Array, refs: readonly Float32Array[], k: number): Match[] {
  const out: Match[] = []
  for (let i = 0; i < refs.length; i++) out.push({ index: i, score: similarity(query, refs[i]) })
  out.sort((a, b) => b.score - a.score || a.index - b.index)
  return out.slice(0, Math.max(0, k))
}

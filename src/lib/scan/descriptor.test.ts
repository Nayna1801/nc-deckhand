import { describe, expect, it } from 'vitest'
import { areaGrid, DESC_LEN, descriptorFromRGBA, rgbToLab, similarity, topMatches } from './descriptor'

/** Imagen RGBA sintética con "dibujo": degradados y manchas que dependen de una semilla. */
function synth(seed: number, w = 120, h = 168): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4)
  let s = seed * 9301 + 49297
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  const blobs = Array.from({ length: 6 }, () => ({ x: rnd() * w, y: rnd() * h, r: 10 + rnd() * 35, c: [rnd() * 255, rnd() * 255, rnd() * 255] }))
  const base = [rnd() * 255, rnd() * 255, rnd() * 255]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let col = [base[0] * (0.4 + y / h), base[1] * (0.4 + x / w), base[2] * (1.2 - y / h)]
      for (const b of blobs) {
        const k = Math.exp(-(((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.r ** 2)))
        col = col.map((v, c) => v * (1 - k) + b.c[c] * k)
      }
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255
    }
  }
  return d
}

/** Reduce una imagen a la mitad promediando 2×2 (otro tamaño de la "misma foto"). */
function half(d: Uint8ClampedArray, w: number, h: number): { data: Uint8ClampedArray; w: number; h: number } {
  const nw = w >> 1
  const nh = h >> 1
  const out = new Uint8ClampedArray(nw * nh * 4)
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
    const a = d[((2 * y) * w + 2 * x) * 4 + c] + d[((2 * y) * w + 2 * x + 1) * 4 + c] + d[((2 * y + 1) * w + 2 * x) * 4 + c] + d[((2 * y + 1) * w + 2 * x + 1) * 4 + c]
    out[(y * nw + x) * 4 + c] = a / 4
  }
  return { data: out, w: nw, h: nh }
}

/** Cambia luz, contraste y tinte como lo haría una cámara. */
function relight(d: Uint8ClampedArray, gain: number, offset: number, tint: [number, number, number]): Uint8ClampedArray {
  const o = new Uint8ClampedArray(d.length)
  for (let i = 0; i < d.length; i += 4) {
    o[i] = d[i] * gain * tint[0] + offset
    o[i + 1] = d[i + 1] * gain * tint[1] + offset
    o[i + 2] = d[i + 2] * gain * tint[2] + offset
    o[i + 3] = 255
  }
  return o
}

describe('huella de carta', () => {
  const W = 120
  const H = 168
  const a = synth(1)

  it('es un vector unitario del tamaño esperado y sin NaN', () => {
    const d = descriptorFromRGBA(a, W, H)
    expect(d).toHaveLength(DESC_LEN)
    expect(d.every(Number.isFinite)).toBe(true)
    expect(Math.hypot(...d)).toBeCloseTo(1, 4)
  })

  it('la misma imagen se parece 1 a sí misma', () => {
    const d = descriptorFromRGBA(a, W, H)
    expect(similarity(d, d)).toBeCloseTo(1, 5)
  })

  it('aguanta cambios de luz, contraste y tinte', () => {
    const base = descriptorFromRGBA(a, W, H)
    const lit = descriptorFromRGBA(relight(a, 0.7, 20, [1.05, 0.95, 1]), W, H)
    expect(similarity(base, lit)).toBeGreaterThan(0.97)
  })

  it('aguanta que la foto tenga otra resolución', () => {
    const base = descriptorFromRGBA(a, W, H)
    const h2 = half(a, W, H)
    expect(similarity(base, descriptorFromRGBA(h2.data, h2.w, h2.h))).toBeGreaterThan(0.98)
  })

  it('distingue cartas distintas y reconoce la buena entre muchas', () => {
    const refs = Array.from({ length: 30 }, (_, i) => descriptorFromRGBA(synth(i + 1), W, H))
    for (const truth of [0, 7, 13, 29]) {
      const photo = relight(synth(truth + 1), 0.8, 10, [1, 1.04, 0.96])
      const [best, second] = topMatches(descriptorFromRGBA(photo, W, H), refs, 2)
      expect(best.index, `carta ${truth}`).toBe(truth)
      expect(best.score).toBeGreaterThan(second.score)
    }
  })

  it('una imagen lisa no produce NaN ni rompe la comparación', () => {
    const flat = new Uint8ClampedArray(W * H * 4).fill(128)
    const d = descriptorFromRGBA(flat, W, H)
    expect(d.every(Number.isFinite)).toBe(true)
    expect(Number.isFinite(similarity(d, descriptorFromRGBA(a, W, H)))).toBe(true)
  })

  it('topMatches ordena de mayor a menor, respeta k y tolera k mayor que el número de referencias', () => {
    const refs = [descriptorFromRGBA(synth(1), W, H), descriptorFromRGBA(synth(2), W, H), descriptorFromRGBA(synth(3), W, H)]
    const q = descriptorFromRGBA(synth(2), W, H)
    const r = topMatches(q, refs, 10)
    expect(r).toHaveLength(3)
    expect(r[0].index).toBe(1)
    expect(r[0].score).toBeGreaterThanOrEqual(r[1].score)
    expect(r[1].score).toBeGreaterThanOrEqual(r[2].score)
    expect(topMatches(q, refs, 0)).toEqual([])
    expect(topMatches(q, [], 3)).toEqual([])
  })

  it('el color Lab es correcto en puntos conocidos', () => {
    const [l0] = rgbToLab(0, 0, 0)
    const [l1, a1, b1] = rgbToLab(255, 255, 255)
    expect(l0).toBeCloseTo(0, 3)
    expect(l1).toBeCloseTo(100, 1)
    expect(Math.abs(a1)).toBeLessThan(0.1)
    expect(Math.abs(b1)).toBeLessThan(0.1)
    const [lr, ar] = rgbToLab(255, 0, 0)
    expect(lr).toBeCloseTo(53.24, 0)
    expect(ar).toBeCloseTo(80.09, 0)
  })

  it('el promedio por área respeta los bordes fraccionarios y el recorte interior', () => {
    // 4×4 con el interior (sin margen) en 100 y todo el marco en 0
    const w = 10
    const h = 10
    const d = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const inner = x >= 1 && x < 9 && y >= 1 && y < 9
      const i = (y * w + x) * 4
      d[i] = d[i + 1] = d[i + 2] = inner ? 100 : 0
      d[i + 3] = 255
    }
    const g = areaGrid(d, w, h, 2, 2, 0.1) // margen 10 % = 1 píxel
    for (let i = 0; i < g.length; i++) expect(g[i]).toBeCloseTo(100, 6)
  })
})

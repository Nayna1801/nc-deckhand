import { describe, expect, it } from 'vitest'
import { guideRect } from './atlas'

describe('marco guía de la carta', () => {
  it('tiene proporción 5:7, queda centrado y dentro de la imagen', () => {
    for (const [w, h] of [[1280, 720], [720, 1280], [640, 480], [1000, 1000], [4000, 3000]]) {
      for (const f of [0.6, 0.8, 0.92, 1]) {
        const r = guideRect(w, h, f)
        expect(r.w / r.h).toBeCloseTo(5 / 7, 6)
        expect(r.x).toBeGreaterThanOrEqual(-1e-9)
        expect(r.y).toBeGreaterThanOrEqual(-1e-9)
        expect(r.x + r.w).toBeLessThanOrEqual(w + 1e-9)
        expect(r.y + r.h).toBeLessThanOrEqual(h + 1e-9)
        expect(r.x + r.w / 2).toBeCloseTo(w / 2, 6)
        expect(r.y + r.h / 2).toBeCloseTo(h / 2, 6)
      }
    }
  })

  it('en un vídeo apaisado la altura manda; en uno vertical muy estrecho manda el ancho', () => {
    expect(guideRect(1280, 720, 0.8).h).toBeCloseTo(576, 6)
    const narrow = guideRect(200, 1000, 0.8)
    expect(narrow.w).toBeCloseTo(160, 6)
  })
})

import { cropVariants, CROP_SCALES, CROP_SHIFTS } from './atlas'
import { descriptorFromRGBA, topMatches } from './descriptor'

describe('recortes de tolerancia al encuadre', () => {
  const rect = guideRect(1280, 720, 0.8)

  it('genera todas las combinaciones de escala y desplazamiento y todas caen dentro de la imagen', () => {
    for (const [w, h] of [[1280, 720], [720, 1280], [640, 480], [400, 560]]) {
      const base = guideRect(w, h, w === 400 ? 0.92 : 0.8)
      const v = cropVariants(base, w, h)
      expect(v).toHaveLength(CROP_SCALES.length * CROP_SHIFTS.length)
      for (const r of v) {
        expect(r.x).toBeGreaterThanOrEqual(-1e-9)
        expect(r.y).toBeGreaterThanOrEqual(-1e-9)
        expect(r.x + r.w).toBeLessThanOrEqual(w + 1e-9)
        expect(r.y + r.h).toBeLessThanOrEqual(h + 1e-9)
        expect(r.w).toBeGreaterThan(0)
      }
    }
  })

  it('el primer recorte de escala 1 sin desplazamiento es el propio marco guía', () => {
    const v = cropVariants(rect, 1280, 720)
    const center = v[CROP_SHIFTS.length * CROP_SCALES.indexOf(1)]
    expect(center.x).toBeCloseTo(rect.x, 6)
    expect(center.w).toBeCloseTo(rect.w, 6)
  })

  it('con varias consultas, el parecido de cada carta es el mejor de ellas', () => {
    const mk = (seed: number) => {
      const w = 60, h = 84, d = new Uint8ClampedArray(w * h * 4)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = (x * seed * 7) % 255; d[i + 1] = (y * seed * 13) % 255; d[i + 2] = ((x + y) * seed) % 255; d[i + 3] = 255 }
      return descriptorFromRGBA(d, w, h)
    }
    const refs = [mk(1), mk(2), mk(3), mk(4)]
    const bad = mk(9)
    const multi = topMatches([bad, refs[2]], refs, 1)
    expect(multi[0].index).toBe(2)
    expect(multi[0].score).toBeCloseTo(1, 5)
    expect(topMatches(refs[1], refs, 1)[0].index).toBe(1) // una sola huella sigue funcionando
  })
})

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

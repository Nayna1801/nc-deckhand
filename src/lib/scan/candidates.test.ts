import { describe, expect, it } from 'vitest'
import { findCandidates, type Atlas } from './atlas'
import { DESC_LEN } from './descriptor'

/** Huella unitaria que apunta sobre todo a una "dirección". */
const vec = (axis: number, mix: [number, number] | null = null): Float32Array => {
  const v = new Float32Array(DESC_LEN)
  v[axis] = 1
  if (mix) v[mix[0]] = mix[1]
  const n = Math.hypot(...v)
  return v.map((x) => x / n)
}

const ref = (card: string, art: string | null) => ({ card, art, image: `cards/${card}.webp`, also: [] })

describe('candidatas del escáner', () => {
  const atlas: Atlas = {
    refs: [ref('a', null), ref('a', 'alt:1'), ref('a', 'alt:2'), ref('b', null), ref('c', null), ref('d', null)],
    descriptors: [vec(0), vec(0, [1, 0.3]), vec(0, [2, 0.5]), vec(3), vec(4), vec(5)],
  }

  it('devuelve cartas distintas aunque varios artes de la misma puntúen más alto', () => {
    const r = findCandidates(atlas, vec(0, [1, 0.1]), 3)
    expect(r.map((c) => c.ref.card)).toEqual(['a', 'b', 'c'])
  })

  it('de cada carta ofrece el arte más parecido', () => {
    const r = findCandidates(atlas, vec(0, [1, 0.3]), 3)
    expect(r[0].ref.card).toBe('a')
    expect(r[0].ref.art).toBe('alt:1')
  })

  it('va de mayor a menor parecido y respeta k', () => {
    const r = findCandidates(atlas, vec(3), 2)
    expect(r).toHaveLength(2)
    expect(r[0].ref.card).toBe('b')
    expect(r[0].score).toBeGreaterThanOrEqual(r[1].score)
  })

  it('con pocas cartas devuelve las que haya y con k=0 nada', () => {
    const tiny: Atlas = { refs: [ref('a', null), ref('a', 'alt:1')], descriptors: [vec(0), vec(1)] }
    expect(findCandidates(tiny, vec(0), 3)).toHaveLength(1)
    expect(findCandidates(atlas, vec(0), 0)).toEqual([])
    expect(findCandidates({ refs: [], descriptors: [] }, vec(0), 3)).toEqual([])
  })
})

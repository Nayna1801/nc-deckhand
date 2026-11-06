import { describe, expect, it } from 'vitest'
import { catalog } from '../lib/catalog'
import { activeFilterCount, applyFilters, EMPTY_FILTERS, type Filters } from './filters'

const run = (f: Partial<Filters>) => applyFilters(catalog.cards, { ...EMPTY_FILTERS, ...f })
const ids = (cards: { id: string }[]) => new Set(cards.map((c) => c.id))

describe('filtros de selección múltiple', () => {
  it('sin filtros devuelve todo el catálogo', () => {
    expect(run({})).toHaveLength(catalog.cards.length)
  })

  it('dos colores suman las cartas de ambos (azul y verde a la vez)', () => {
    const blue = run({ color: ['Blue'] })
    const green = run({ color: ['Green'] })
    const both = run({ color: ['Blue', 'Green'] })
    expect(blue.length).toBeGreaterThan(0)
    expect(green.length).toBeGreaterThan(0)
    expect(both).toHaveLength(blue.length + green.length)
    expect(both.every((c) => c.color === 'Blue' || c.color === 'Green')).toBe(true)
  })

  it('varios filtros distintos se cruzan (Y) y cada uno suma sus opciones (O)', () => {
    const r = run({ color: ['Blue', 'Green'], type: ['Unit'], cost: ['1', '2'] })
    expect(r.length).toBeGreaterThan(0)
    for (const c of r) {
      expect(['Blue', 'Green']).toContain(c.color)
      expect(c.type).toBe('Unit')
      expect([1, 2]).toContain(c.cost)
    }
  })

  it('coste con tramo abierto: 9+ y 0 juntos', () => {
    const r = run({ cost: ['0', '9+'] })
    expect(r.every((c) => c.cost === 0 || (c.cost ?? -1) >= 9)).toBe(true)
  })

  it('etiquetas en modo "cualquiera" une las cartas de cada etiqueta', () => {
    const quick = run({ tags: ['Quickhack'] })
    const brain = run({ tags: ['Braindance'] })
    const any = run({ tags: ['Quickhack', 'Braindance'], tagsMode: 'any' })
    expect(quick.length).toBeGreaterThan(0)
    expect(brain.length).toBeGreaterThan(0)
    expect(ids(any)).toEqual(new Set([...ids(quick), ...ids(brain)]))
  })

  it('etiquetas en modo "todas" exige todas a la vez', () => {
    const all = run({ tags: ['Arasaka', 'Corpo'], tagsMode: 'all' })
    expect(all.length).toBeGreaterThan(0)
    expect(all.every((c) => c.classifications.includes('Arasaka') && c.classifications.includes('Corpo'))).toBe(true)
    expect(all.length).toBeLessThanOrEqual(run({ tags: ['Arasaka', 'Corpo'], tagsMode: 'any' }).length)
  })

  it('elegir varios sets incluye las cartas impresas en cualquiera de ellos', () => {
    const a = run({ set: ['Judge Promos'] })
    const b = run({ set: ['Set 1 Promos'] })
    const both = run({ set: ['Judge Promos', 'Set 1 Promos'] })
    expect(ids(both)).toEqual(new Set([...ids(a), ...ids(b)]))
  })

  it('cuenta cada filtro de lista como uno aunque tenga varias opciones', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0)
    expect(activeFilterCount({ ...EMPTY_FILTERS, color: ['Blue', 'Green'], tags: ['Quickhack'] })).toBe(2)
  })
})

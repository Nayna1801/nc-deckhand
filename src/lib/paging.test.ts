import { describe, expect, it } from 'vitest'
import { clampPage, pageCount, pageItems, pageRange, pageWindow } from './paging'

describe('paginación', () => {
  it('cuenta las páginas (mínimo una, aunque esté vacío)', () => {
    expect(pageCount(0, 10)).toBe(1)
    expect(pageCount(10, 10)).toBe(1)
    expect(pageCount(11, 10)).toBe(2)
    expect(pageCount(398, 48)).toBe(9)
    expect(pageCount(-5, 10)).toBe(1)
  })

  it('mantiene la página dentro de rango', () => {
    expect(clampPage(0, 100, 10)).toBe(1)
    expect(clampPage(-3, 100, 10)).toBe(1)
    expect(clampPage(99, 100, 10)).toBe(10)
    expect(clampPage(Number.NaN, 100, 10)).toBe(1)
    expect(clampPage(2.9, 100, 10)).toBe(2)
    expect(clampPage(5, 0, 10)).toBe(1)
  })

  it('corta la lista por páginas sin perder ni repetir elementos', () => {
    const items = Array.from({ length: 25 }, (_, i) => i)
    const all = [1, 2, 3].flatMap((p) => pageItems(items, p, 10))
    expect(all).toEqual(items)
    expect(pageItems(items, 3, 10)).toHaveLength(5)
    expect(pageItems(items, 99, 10)).toEqual(pageItems(items, 3, 10))
    expect(pageItems([], 1, 10)).toEqual([])
  })

  it('no modifica la lista original', () => {
    const items = [1, 2, 3]
    pageItems(items, 1, 2)
    expect(items).toEqual([1, 2, 3])
  })

  it('indica qué elementos muestra cada página', () => {
    expect(pageRange(1, 25, 10)).toEqual({ from: 1, to: 10 })
    expect(pageRange(3, 25, 10)).toEqual({ from: 21, to: 25 })
    expect(pageRange(1, 0, 10)).toEqual({ from: 0, to: 0 })
  })

  it('muestra primera, última y vecinas, con huecos solo cuando faltan 2 o más', () => {
    expect(pageWindow(1, 1)).toEqual([1])
    expect(pageWindow(1, 3)).toEqual([1, 2, 3])
    expect(pageWindow(1, 9)).toEqual([1, 2, '…', 9])
    expect(pageWindow(5, 9)).toEqual([1, '…', 4, 5, 6, '…', 9])
    expect(pageWindow(3, 9)).toEqual([1, 2, 3, 4, '…', 9])
    expect(pageWindow(9, 9)).toEqual([1, '…', 8, 9])
    expect(pageWindow(4, 6)).toEqual([1, 2, 3, 4, 5, 6])
  })
})

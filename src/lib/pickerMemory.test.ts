import { describe, expect, it } from 'vitest'
import { EMPTY_PICKER_MEMORY, loadPickerMemory, PICKER_MEMORY_KEY, sanitizePickerMemory, savePickerMemory, type PickerMemory } from './pickerMemory'

const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m }
}

describe('memoria de la ventana de elegir carta', () => {
  it('sin nada guardado empieza de cero: arriba, página 1, sin búsqueda', () => {
    expect(loadPickerMemory(memory())).toEqual(EMPTY_PICKER_MEMORY)
    expect(EMPTY_PICKER_MEMORY).toMatchObject({ q: '', page: 1, scroll: 0, onlyArts: false, onlyOwned: null })
  })

  it('guarda y recupera búsqueda, filtros, página y posición', () => {
    const st = memory()
    const m: PickerMemory = { q: 'saul', onlyOwned: false, onlyArts: true, page: 3, scroll: 1240 }
    expect(savePickerMemory(m, st)).toBe(true)
    expect(loadPickerMemory(st)).toEqual(m)
  })

  it('distingue «no lo he tocado» (null) de «lo desmarqué» (false)', () => {
    const st = memory()
    savePickerMemory({ ...EMPTY_PICKER_MEMORY, onlyOwned: false }, st)
    expect(loadPickerMemory(st).onlyOwned).toBe(false)
    savePickerMemory(EMPTY_PICKER_MEMORY, st)
    expect(loadPickerMemory(st).onlyOwned).toBeNull()
  })

  it('valores corruptos o fuera de rango se corrigen sin romper', () => {
    expect(sanitizePickerMemory({ q: 5, onlyOwned: 'si', onlyArts: 1, page: -4, scroll: -10 })).toEqual(EMPTY_PICKER_MEMORY)
    expect(sanitizePickerMemory({ page: 'x', scroll: NaN })).toEqual(EMPTY_PICKER_MEMORY)
    expect(sanitizePickerMemory({ page: 1e9, scroll: 1e12 })).toMatchObject({ page: 1000, scroll: 1_000_000 })
    expect(sanitizePickerMemory({ page: 2.9 }).page).toBe(2)
    expect(sanitizePickerMemory({ q: 'x'.repeat(500) }).q).toHaveLength(120)
    for (const bad of [null, undefined, 'texto', 7, [1, 2]]) expect(sanitizePickerMemory(bad)).toEqual(EMPTY_PICKER_MEMORY)
  })

  it('un JSON roto o un almacenamiento que falla no lanzan: se empieza de cero', () => {
    const st = memory()
    st.setItem(PICKER_MEMORY_KEY, '{no es json')
    expect(loadPickerMemory(st)).toEqual(EMPTY_PICKER_MEMORY)
    const broken = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('lleno') } }
    expect(loadPickerMemory(broken)).toEqual(EMPTY_PICKER_MEMORY)
    expect(savePickerMemory(EMPTY_PICKER_MEMORY, broken)).toBe(false)
    expect(savePickerMemory(EMPTY_PICKER_MEMORY, undefined)).toBe(false)
  })
})

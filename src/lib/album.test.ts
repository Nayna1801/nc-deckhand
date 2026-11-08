import { describe, expect, it } from 'vitest'
import { addPage, albumKey, columnsOf, emptyAlbum, fillAlbum, filled, insertSlot, loadAlbum, MAX_SLOTS, pageCount, pageSlots, removePage, removeSlot, sanitizeAlbum, saveAlbum, setPerPage, setSlot, swapSlots, type Album, type AlbumSlot } from './album'

const s = (card: string, print?: string): AlbumSlot => (print ? { card, print } : { card })
const album = (slots: (AlbumSlot | null)[], perPage: 4 | 9 | 12 = 4): Album => ({ name: 'T', perPage, slots })
const names = (a: Album) => a.slots.map((x) => x?.card ?? null)
const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('páginas del álbum', () => {
  it('un álbum vacío tiene una página de huecos y las columnas salen del tamaño de página', () => {
    const a = emptyAlbum()
    expect(pageCount(a)).toBe(1)
    expect(pageSlots(a, 0)).toEqual(Array(9).fill(null))
    expect(([4, 9, 12] as const).map(columnsOf)).toEqual([2, 3, 4])
  })

  it('las páginas salen de partir la lista; la última se rellena con huecos', () => {
    const a = album([s('a'), s('b'), s('c'), s('d'), s('e')])
    expect(pageCount(a)).toBe(2)
    expect(pageSlots(a, 0).map((x) => x?.card)).toEqual(['a', 'b', 'c', 'd'])
    expect(pageSlots(a, 1).map((x) => x?.card ?? null)).toEqual(['e', null, null, null])
    expect(pageSlots(a, 99)).toEqual(pageSlots(a, 1)) // una página inexistente cae en la última
  })

  it('cambiar el tamaño de página reparte el mismo contenido en otras páginas y nada se pierde', () => {
    const a = album(Array.from({ length: 10 }, (_, i) => s('c' + i)), 4)
    const b = setPerPage(a, 9)
    expect(b.slots).toEqual(a.slots)
    expect(pageCount(b)).toBe(2)
    expect(pageSlots(b, 1).filter(Boolean)).toHaveLength(1)
  })

  it('añadir página crea una vacía al final (completa antes la última) y quitarla borra solo esa', () => {
    let a = album([s('a'), s('b'), s('c')])
    a = addPage(a)
    expect(pageCount(a)).toBe(2)
    expect(pageSlots(a, 1).every((x) => x === null)).toBe(true)
    a = setSlot(a, 5, s('z'))
    expect(names(removePage(a, 0))).toEqual([null, 'z', null, null])
    expect(pageCount(removePage(album([s('a')]), 0))).toBe(1) // siempre queda una
    expect(filled(removePage(album([s('a')]), 0))).toBe(1)
  })
})

describe('editar bolsillos', () => {
  it('poner, vaciar, insertar y quitar no mutan el álbum original', () => {
    const a = album([s('a'), s('b')])
    const frozen = JSON.stringify(a)
    const put = setSlot(a, 1, s('x'))
    expect(names(put)).toEqual(['a', 'x'])
    expect(setSlot(put, 0, null).slots[0]).toBeNull()
    expect(names(insertSlot(a, 1))).toEqual(['a', null, 'b'])
    expect(names(removeSlot(a, 0))).toEqual(['b'])
    expect(JSON.stringify(a)).toBe(frozen)
  })

  it('poner una carta lejos del final crea los huecos intermedios; los índices absurdos no revientan', () => {
    const a = setSlot(emptyAlbum(), 12, s('a'))
    expect(a.slots).toHaveLength(13)
    expect(filled(a)).toBe(1)
    expect(setSlot(emptyAlbum(), 10 ** 9, s('a')).slots.length).toBeLessThanOrEqual(MAX_SLOTS)
    expect(setSlot(emptyAlbum(), -5, s('a')).slots[0]).toEqual(s('a'))
    expect(removeSlot(album([s('a')]), 5).slots).toHaveLength(1)
  })

  it('intercambiar mueve una carta a un hueco o a otra carta, y consigo misma no hace nada', () => {
    const a = album([s('a'), s('b'), null, null])
    expect(names(swapSlots(a, 0, 1))).toEqual(['b', 'a', null, null])
    expect(names(swapSlots(a, 0, 3))).toEqual([null, 'b', null, 'a'])
    expect(swapSlots(a, 1, 1)).toBe(a)
    expect(names(swapSlots(album([s('a')]), 0, 6))).toEqual([null, null, null, null, null, null, 'a'])
  })
})

describe('rellenar el álbum', () => {
  const list = [s('a'), s('b'), s('c')]
  it('reemplazar lo sustituye entero y quita repetidas', () => {
    expect(names(fillAlbum(album([s('z')]), [...list, s('a')], 'replace'))).toEqual(['a', 'b', 'c'])
  })

  it('añadir sigue tras lo último, sin repetir lo ya colocado y respetando los huecos del medio', () => {
    expect(names(fillAlbum(album([s('a'), null, s('x'), null, null]), list, 'append'))).toEqual(['a', null, 'x', 'b', 'c'])
  })

  it('la misma carta con otro arte cuenta como otra entrada', () => {
    expect(fillAlbum(emptyAlbum(), [s('a'), s('a', 'a@Set#1')], 'replace').slots).toHaveLength(2)
  })

  it('no pasa del tope de bolsillos', () => {
    const many = Array.from({ length: MAX_SLOTS + 50 }, (_, i) => s('c' + i))
    expect(fillAlbum(emptyAlbum(), many, 'replace').slots).toHaveLength(MAX_SLOTS)
  })
})

describe('guardado y datos del navegador', () => {
  const exists = (id: string) => id !== 'borrada'
  const valid = (x: AlbumSlot) => x.print !== 'mala'

  it('guarda y recupera el álbum tal cual, con clave propia por usuario', () => {
    const st = memory()
    const a = { ...album([s('a', 'a@S#1'), null, s('b')], 9), name: 'Favoritas' }
    expect(saveAlbum(albumKey('u1'), a, st)).toBe(true)
    expect(albumKey('u1')).not.toBe(albumKey('u2'))
    expect(albumKey(null)).toContain('invitado')
    expect(loadAlbum(albumKey('u1'), valid, exists, st)).toEqual(a)
    expect(loadAlbum(albumKey('u2'), valid, exists, st)).toEqual(emptyAlbum())
  })

  it('datos corruptos o manipulados no rompen: vuelve al álbum vacío o limpia lo inválido', () => {
    const st = memory()
    st.setItem('k', '{no es json')
    expect(loadAlbum('k', valid, exists, st)).toEqual(emptyAlbum())
    expect(sanitizeAlbum(null, valid, exists)).toEqual(emptyAlbum())
    expect(sanitizeAlbum([1, 2], valid, exists)).toEqual(emptyAlbum())
    const dirty = sanitizeAlbum({ name: '   ', perPage: 7, slots: [{ card: 'a' }, { card: 'borrada' }, 5, { card: 'a', print: 'mala' }, { card: 'b', print: 'ok' }, { nada: 1 }] }, valid, exists)
    expect(dirty.perPage).toBe(9)
    expect(dirty.name).toBe('Mi álbum')
    expect(dirty.slots).toEqual([{ card: 'a' }, null, null, { card: 'a' }, { card: 'b', print: 'ok' }, null])
  })

  it('el nombre se recorta y un almacenamiento que falla no lanza', () => {
    expect(sanitizeAlbum({ name: 'x'.repeat(500), slots: [] }, valid, exists).name.length).toBeLessThanOrEqual(40)
    const broken = { setItem: () => { throw new Error('lleno') }, getItem: () => { throw new Error('bloqueado') } }
    expect(saveAlbum('k', emptyAlbum(), broken)).toBe(false)
    expect(loadAlbum('k', valid, exists, broken)).toEqual(emptyAlbum())
    expect(saveAlbum('k', emptyAlbum(), undefined)).toBe(false)
  })
})

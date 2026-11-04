import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { catalog } from './catalog'

const PUBLIC = join(process.cwd(), 'public')
const isWebp = (file: string) => {
  const head = readFileSync(file).subarray(0, 12)
  return head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP'
}

describe('imágenes de las cartas', () => {
  it('cada carta base tiene su imagen WebP', () => {
    for (const c of catalog.cards) {
      const f = join(PUBLIC, c.image)
      expect(existsSync(f), `falta ${c.image}`).toBe(true)
      expect(isWebp(f), `${c.image} no es WebP`).toBe(true)
    }
  })
})

describe('imágenes de artes alternativos', () => {
  const alts = catalog.cards.flatMap((c) => c.altArts.map((a) => ({ cardId: c.id, ...a })))

  it('hay artes alternativos y todos tienen imagen', () => {
    expect(alts.length).toBe(102)
    expect(alts.filter((a) => !a.image)).toEqual([])
  })

  it('las rutas son seguras y el nombre es único', () => {
    const paths = alts.map((a) => a.image as string)
    for (const p of paths) expect(p, p).toMatch(/^cards\/alt\/[\w.-]+\.webp$/)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('cada fichero existe, es una imagen WebP de verdad y tiene un tamaño razonable', () => {
    for (const a of alts) {
      const f = join(PUBLIC, a.image as string)
      expect(existsSync(f), `falta ${a.image}`).toBe(true)
      expect(isWebp(f), `${a.image} no es WebP`).toBe(true)
      const kb = statSync(f).size / 1024
      expect(kb, `${a.image} pesa ${Math.round(kb)} KB`).toBeGreaterThan(5)
      expect(kb, `${a.image} pesa ${Math.round(kb)} KB`).toBeLessThan(500)
    }
  })

  it('no sobran ficheros: todo lo que hay en disco está referenciado', () => {
    const referenced = new Set(alts.map((a) => (a.image as string).split('/').pop()))
    const orphans = readdirSync(join(PUBLIC, 'cards', 'alt')).filter((f) => !referenced.has(f))
    expect(orphans).toEqual([])
  })

  it('las 26 Legends tienen al menos un arte alternativo con imagen', () => {
    const legends = catalog.cards.filter((c) => c.type === 'Legend')
    expect(legends.length).toBe(26)
    expect(legends.every((l) => l.altArts.some((a) => a.image))).toBe(true)
  })
})

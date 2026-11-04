import { describe, expect, it } from 'vitest'
import { catalog } from './catalog'
import { parseSearch, SEARCH_FIELDS } from './search'
import type { Card } from './types'

const run = (q: string): Card[] => {
  const s = parseSearch(q)
  return catalog.cards.filter(s.match)
}
const ids = (q: string) => run(q).map((c) => c.id)

describe('texto libre', () => {
  it('una consulta vacía devuelve todo', () => {
    expect(run('')).toHaveLength(150)
    expect(run('   ')).toHaveLength(150)
  })

  it('busca por nombre, ignorando mayúsculas y acentos', () => {
    expect(ids('saul bright')).toEqual(['saul_bright_stormrider'])
    expect(ids('SAUL')).toContain('saul_bright_stormrider')
    expect(ids('alvarez').length).toBeGreaterThan(0)
  })

  it('varias palabras se combinan con AND', () => {
    expect(ids('goro hands')).toEqual(['goro_takemura_hands_unclean'])
  })

  it('una frase entre comillas debe aparecer tal cual', () => {
    expect(ids('"hands unclean"')).toEqual(['goro_takemura_hands_unclean'])
    expect(ids('"unclean hands"')).toEqual([])
  })
})

describe('tipo, color y rareza', () => {
  it('t: / type: filtran por tipo (con prefijo)', () => {
    expect(run('t:legend')).toHaveLength(26)
    expect(run('type:unit')).toHaveLength(73)
    expect(run('t:prog')).toHaveLength(34)
  })

  it('c: / color: aceptan nombre, prefijo o inicial', () => {
    const red = catalog.cards.filter((c) => c.color === 'Red').length
    expect(run('c:red')).toHaveLength(red)
    expect(run('color:red')).toHaveLength(red)
    expect(run('c:r')).toHaveLength(red)
  })

  it('combina tipo y color como en ripperdeck', () => {
    const expected = catalog.cards.filter((c) => c.type === 'Unit' && c.color === 'Red')
    expect(run('t:unit c:red')).toHaveLength(expected.length)
  })

  it('r: filtra por rareza', () => {
    expect(run('r:secret')).toHaveLength(4)
    expect(run('rarity:epic')).toHaveLength(18)
  })
})

describe('comparaciones numéricas', () => {
  const count = (f: (c: Card) => boolean) => catalog.cards.filter(f).length

  it('cost con todos los operadores', () => {
    expect(run('cost=3')).toHaveLength(count((c) => c.cost === 3))
    expect(run('cost:3')).toHaveLength(count((c) => c.cost === 3))
    expect(run('cost<=2')).toHaveLength(count((c) => c.cost != null && c.cost <= 2))
    expect(run('cost<2')).toHaveLength(count((c) => c.cost != null && c.cost < 2))
    expect(run('cost>=7')).toHaveLength(count((c) => c.cost != null && c.cost >= 7))
    expect(run('cost>7')).toHaveLength(count((c) => c.cost != null && c.cost > 7))
    expect(run('cost!=3')).toHaveLength(count((c) => c.cost != null && c.cost !== 3))
  })

  it('las cartas sin valor (p. ej. Legends sin coste) nunca cumplen una comparación', () => {
    expect(run('cost<=99').every((c) => c.cost != null)).toBe(true)
  })

  it('power y ram (con alias pow)', () => {
    expect(run('power>=10')).toHaveLength(count((c) => c.power != null && c.power >= 10))
    expect(run('pow>=10')).toHaveLength(run('power>=10').length)
    expect(run('ram:2')).toHaveLength(87)
    expect(run('ram>=4')).toHaveLength(count((c) => c.ram != null && c.ram >= 4))
  })
})

describe('texto de reglas, keywords, facciones, artista', () => {
  it('o: busca en el texto de reglas', () => {
    expect(run('o:draw').length).toBeGreaterThan(0)
    expect(run('o:draw').every((c) => /draw/i.test(c.rules))).toBe(true)
    expect(run('o:"draw 1"').every((c) => /draw 1/i.test(c.rules))).toBe(true)
  })

  it('k: encuentra keywords y disparadores {..} del texto', () => {
    const blockers = catalog.cards.filter((c) => /\{blocker\}/i.test(c.rules)).length
    expect(blockers).toBeGreaterThan(0)
    expect(run('k:blocker')).toHaveLength(blockers)
    const solo = catalog.cards.filter((c) => /\{go solo\}/i.test(c.rules)).length
    expect(run('k:"go solo"')).toHaveLength(solo)
    expect(run('k:gosolo')).toHaveLength(solo)
    expect(run('when:spend')).toHaveLength(catalog.cards.filter((c) => /\{spend\}/i.test(c.rules)).length)
  })

  it('f: / trait: filtran por facción o clasificación', () => {
    expect(run('f:arasaka')).toHaveLength(19)
    expect(run('trait:arasaka')).toHaveLength(19)
  })

  it('a: filtra por artista', () => {
    const any = catalog.cards.find((c) => c.artist)!
    expect(ids(`a:"${any.artist}"`)).toContain(any.id)
  })

  it('legal: filtra por legalidad', () => {
    expect(run('legal:legal')).toHaveLength(150)
    expect(run('legal:banned')).toHaveLength(0)
  })
})

describe('sets, números e impresiones (variantes)', () => {
  it('s: coincide con el set principal o con cualquier impresión', () => {
    const beta = catalog.cards.filter((c) => c.printings.some((p) => /beta/i.test(p.baseSetName)))
    expect(beta.length).toBeGreaterThan(0)
    expect(run('s:beta')).toHaveLength(beta.length)
    expect(run('set:beta').length).toBeGreaterThan(run('set:"night city brawl"').length - 1)
  })

  it('lang:fr y has:fr encuentran cartas con versión francesa', () => {
    const fr = catalog.cards.filter((c) => c.printings.some((p) => p.language === 'fr'))
    expect(fr.length).toBeGreaterThan(0)
    expect(run('lang:fr')).toHaveLength(fr.length)
    expect(run('has:fr')).toHaveLength(fr.length)
  })

  it('has:alt y alt: usan las artes alternativas', () => {
    expect(run('has:alt')).toHaveLength(62)
    const nova = catalog.cards.filter((c) => c.altArts.some((a) => /nova/i.test(`${a.rarity} ${a.label}`)))
    expect(nova.length).toBeGreaterThan(0)
    expect(run('alt:nova')).toHaveLength(nova.length)
  })

  it('has:promo encuentra impresiones promocionales', () => {
    const promo = catalog.cards.filter((c) => c.printings.some((p) => /promo/i.test(`${p.baseSetName} ${p.edition}`)))
    expect(run('has:promo')).toHaveLength(promo.length)
  })

  it('num: busca el número de coleccionista en cualquier impresión', () => {
    const goro = ids('num:012')
    expect(goro).toContain('goro_takemura_hands_unclean')
    expect(goro).toContain('kerry_eurodyne_the_last_rockerboy')
  })

  it('name: busca solo en el nombre (no en las reglas)', () => {
    expect(ids('name:draw').every((id) => /draw/i.test(catalog.byId[id].displayName))).toBe(true)
  })
})

describe('negación y OR', () => {
  it('- niega un término', () => {
    expect(run('t:unit -c:red')).toHaveLength(catalog.cards.filter((c) => c.type === 'Unit' && c.color !== 'Red').length)
    expect(run('-t:legend')).toHaveLength(124)
  })

  it('or une grupos de términos', () => {
    expect(run('t:legend or t:gear')).toHaveLength(26 + 17)
    expect(run('t:legend c:red or t:gear c:blue')).toHaveLength(
      catalog.cards.filter((c) => (c.type === 'Legend' && c.color === 'Red') || (c.type === 'Gear' && c.color === 'Blue')).length,
    )
  })

  it('OR en mayúsculas también vale', () => {
    expect(run('t:legend OR t:gear')).toHaveLength(43)
  })
})

describe('errores y casos límite', () => {
  it('un campo desconocido se avisa y se ignora (no vacía los resultados)', () => {
    const s = parseSearch('t:unit foo:bar')
    expect(s.errors.join(' ')).toMatch(/foo/)
    expect(catalog.cards.filter(s.match)).toHaveLength(73)
  })

  it('un valor numérico inválido se avisa y se ignora', () => {
    const s = parseSearch('cost:abc')
    expect(s.errors.join(' ')).toMatch(/cost/)
    expect(catalog.cards.filter(s.match)).toHaveLength(150)
  })

  it('valores de tipo/color/rareza desconocidos se avisan', () => {
    expect(parseSearch('t:robot').errors.length).toBe(1)
    expect(parseSearch('c:purple').errors.length).toBe(1)
    expect(parseSearch('r:mitica').errors.length).toBe(1)
  })

  it('comillas sin cerrar no rompen la búsqueda', () => {
    const s = parseSearch('o:"draw')
    expect(() => catalog.cards.filter(s.match)).not.toThrow()
  })

  it('un campo sin valor se avisa', () => {
    expect(parseSearch('t:').errors.length).toBe(1)
  })

  it('no ejecuta regex ni código: los caracteres especiales son literales', () => {
    expect(() => run('o:(.*+')).not.toThrow()
    expect(run('o:(.*+')).toHaveLength(0)
    expect(run('.*')).toHaveLength(0)
  })

  it('consultas enormes no cuelgan la búsqueda', () => {
    const t = Date.now()
    run('a '.repeat(2000))
    expect(Date.now() - t).toBeLessThan(2000)
  })
})

describe('documentación de campos', () => {
  it('cada campo declara alias y descripción', () => {
    expect(SEARCH_FIELDS.length).toBeGreaterThan(10)
    for (const f of SEARCH_FIELDS) {
      expect(f.aliases.length).toBeGreaterThan(0)
      expect(f.description.length).toBeGreaterThan(5)
      expect(f.example.length).toBeGreaterThan(2)
    }
  })

  it('todos los ejemplos documentados se parsean sin errores', () => {
    for (const f of SEARCH_FIELDS) expect(parseSearch(f.example).errors, f.example).toEqual([])
  })
})

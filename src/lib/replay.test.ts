import { describe, expect, it } from 'vitest'
import { dieOwner, eddiesOf, isDiceLine, isEnd, isNewCopy, isTurnHeader, stepLabel, streetCred, whoOf, zoneCounts, type ReplayPlayer, type ReplayState } from './replay'

const player = (over: Partial<ReplayPlayer> = {}): ReplayPlayer => ({
  h: [],
  f: [],
  l: [
    ['a', 0, 1, 0, []],
    ['b', 0, 1, 0, []],
    ['c', 0, 1, 0, []],
  ],
  e: [0, 0],
  g: [],
  x: [4, 6, 8, 10, 12, 20],
  d: 34,
  t: 0,
  ...over,
})

describe('eddiesOf', () => {
  it('al empezar, con 0 Eddies sueltos, las 3 Legends cuentan como 3/3 (como el simulador oficial)', () => {
    expect(eddiesOf(player())).toEqual({ loose: 0, legends: 3, total: 3, ready: 3 })
  })

  it('suma los Eddies sueltos a las Legends en juego', () => {
    expect(eddiesOf(player({ e: [2, 1] }))).toEqual({ loose: 2, legends: 3, total: 5, ready: 4 })
  })

  it('una Legend gastada cuenta en el total pero no en los preparados', () => {
    const p = player({ l: [['a', 1, 0, 0, []], ['b', 0, 1, 0, []], ['c', 0, 1, 0, []]] })
    expect(eddiesOf(p)).toMatchObject({ total: 3, ready: 2 })
  })

  it('una Legend retirada del juego (Go Solo que salió) ya no cuenta', () => {
    const p = player({ e: [1, 1], l: [['a', 1, 0, 1, []], ['b', 0, 1, 0, []], ['c', 0, 1, 0, []]] })
    expect(eddiesOf(p)).toEqual({ loose: 1, legends: 2, total: 3, ready: 3 })
  })
})

describe('texto de la consola', () => {
  it('reconoce de qué jugador es cada línea', () => {
    expect(whoOf('   J1 juega Psycho Squad')).toBe(1)
    expect(whoOf('T4 J2: 1€ mano 8 Gigs [3] vs [4] | mesa []')).toBe(2)
    expect(whoOf('FIN en el turno 14: Gana J2')).toBe(0)
    expect(whoOf('Preparación: J1 empieza')).toBe(0)
  })

  it('resume las líneas de inicio de turno', () => {
    expect(isTurnHeader('T3 J1: 1€ mano 7 Gigs [] vs [] | mesa []')).toBe(true)
    expect(stepLabel('T3 J1: 1€ mano 7 Gigs [] vs [] | mesa []')).toBe('Turno 3 · empieza J1')
    expect(stepLabel('T3 J1: 1€ mano 7', true)).toBe('Empieza el turno de J1')
    expect(stepLabel('   J1 vende Towerfall (+1 €)')).toBe('J1 vende Towerfall (+1 €)')
    expect(isEnd('FIN en el turno 14')).toBe(true)
  })

  it('calcula el Street Cred', () => {
    expect(streetCred(player({ g: [[4, 3, 0], [6, 5, 1], [8, 1, 0]] }))).toBe(9)
  })
})

describe('dados', () => {
  it('el dueño de un dado robado sigue siendo el original', () => {
    expect(dieOwner([8, 5, 1], 0)).toBe(1)
    expect(dieOwner([8, 5, 0], 0)).toBe(0)
  })

  it('en grabaciones antiguas, sin dueño anotado, el dado es de quien lo tiene', () => {
    expect(dieOwner([8, 5], 1)).toBe(1)
  })

  it('reconoce las líneas de consola que hablan de dados', () => {
    expect(isDiceLine('   ⚄ J1 roba el d4 de J2 (valor 1)')).toBe(true)
    expect(isDiceLine('   ⚄ d8 de J2: 5 → 4')).toBe(true)
    expect(isDiceLine('   J1 vende Towerfall (+1 €)')).toBe(false)
  })
})

describe('cartas nuevas entre dos pasos', () => {
  const st = (h: string[], f: string[]): ReplayState => ({
    n: 1,
    p: [player({ h, f: f.map((id) => [id, 3, 1, 0, [], 0] as ReplayPlayer['f'][number]) }), player()],
  })

  it('cuenta copias por zona y jugador', () => {
    const m = zoneCounts(st(['x', 'x', 'y'], ['z']))
    expect(m.get('0|h|x')).toBe(2)
    expect(m.get('0|f|z')).toBe(1)
  })

  it('marca como nueva solo la copia que antes no estaba', () => {
    const prev = zoneCounts(st(['x', 'x'], []))
    expect(isNewCopy(prev, '0|h|x', 1)).toBe(false)
    expect(isNewCopy(prev, '0|h|x', 2)).toBe(false)
    expect(isNewCopy(prev, '0|h|x', 3)).toBe(true)
    expect(isNewCopy(null, '0|h|x', 1)).toBe(false)
  })
})

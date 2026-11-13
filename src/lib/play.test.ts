import { describe, expect, it } from 'vitest'
import { currentPlayer, groupOptions, resultText, type PlayEnd, type PlayOption } from './play'
import { lineKinds, zoneCounts, type ReplayPlayer, type ReplayState } from './replay'

const opt = (label: string, group?: string): PlayOption => ({ label, group })

describe('groupOptions', () => {
  it('ordena los grupos como se juega y conserva la posición original de cada opción', () => {
    const options = [opt('Terminar el turno', 'fin'), opt('Atacar con X', 'atacar'), opt('Vender A', 'vender'), opt('Jugar B', 'jugar'), opt('Vender C', 'vender')]
    const groups = groupOptions(options)
    expect(groups.map((g) => g.group)).toEqual(['vender', 'jugar', 'atacar', 'fin'])
    expect(groups[0].items.map((i) => [i.option.label, i.index])).toEqual([['Vender A', 2], ['Vender C', 4]])
    expect(groups[3].items[0].index).toBe(0)
  })

  it('un grupo desconocido sale con su nombre, justo antes de terminar', () => {
    const groups = groupOptions([opt('Fin', 'fin'), opt('Algo', 'raro'), opt('Dado', 'dado')])
    expect(groups.map((g) => g.group)).toEqual(['dado', 'raro', 'fin'])
    expect(groups[1].title).toBe('raro')
  })

  it('una opción sin grupo no se pierde', () => {
    const groups = groupOptions([opt('Sola')])
    expect(groups).toHaveLength(1)
    expect(groups[0].items[0].index).toBe(0)
  })
})

describe('consola en vivo', () => {
  it('detecta de quién es el turno por el último inicio de turno', () => {
    expect(currentPlayer([])).toBe(0)
    expect(currentPlayer(['Preparación: J1 empieza', '   J1 hace mulligan'])).toBe(0)
    expect(currentPlayer(['T1 J1: 1€ mano 7', '   J1 juega X', 'T2 J2: 1€ mano 7', '   J2 vende una carta (+1 €)'])).toBe(2)
  })

  it('da la misma clase de color a cada línea que la reproducción de partidas', () => {
    expect(lineKinds('T3 J1: 1€ mano 8')).toEqual(['turn'])
    expect(lineKinds('FIN en el turno 14: Gana J2')).toEqual(['end'])
    expect(lineKinds('   ⚄ J1 tira su d8: sale 5')).toEqual(['dice'])
    expect(lineKinds('   J2 juega Psycho Squad')).toEqual(['j2'])
    expect(lineKinds('Preparación: J1 empieza')).toEqual([])
  })

  it('cuenta las cartas de una mano con cartas ocultas sin romperse', () => {
    const p = (h: (string | null)[]): ReplayPlayer => ({ h, f: [], l: [], e: [0, 0], g: [], x: [], d: 30, t: 0 })
    const state: ReplayState = { n: 2, p: [p(['a', 'a']), p([null, null, null])] }
    const m = zoneCounts(state)
    expect(m.get('0|h|a')).toBe(2)
    expect([...m.keys()].some((k) => k.includes('null'))).toBe(false)
  })
})

describe('resultText', () => {
  const end = (winner: number, won: boolean): PlayEnd => ({ type: 'end', winner, won, me: 0, log: [], game: {} as PlayEnd['game'], cards: {}, saved: null })
  it('habla desde el punto de vista de quien juega', () => {
    expect(resultText(end(0, true))).toBe('Has ganado')
    expect(resultText(end(1, false))).toBe('Ha ganado el piloto')
    expect(resultText(end(-1, false))).toBe('Empate')
  })
})

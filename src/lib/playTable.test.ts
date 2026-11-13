import { describe, expect, it } from 'vitest'
import type { PlayOption } from './play'
import { actorKeys, candidateKeys, dropOption, globalOptions, optionForRef, optionsFor, payHint, payOption, refKey, zoneOptions } from './playTable'

const hand = (id: string) => ({ z: 'h', side: 0, id })
const unit = (i: number, side = 0) => ({ z: 'f', side, i })
const leg = (i: number) => ({ z: 'l', side: 0, i })

const OPTIONS: PlayOption[] = [
  { label: 'Vender Floor It', group: 'vender', card: 'floor_it', src: hand('floor_it') },
  { label: 'Jugar Floor It', group: 'jugar', card: 'floor_it', src: hand('floor_it') },
  { label: 'Jugar Psycho Squad', group: 'jugar', card: 'psycho_squad', src: hand('psycho_squad') },
  { label: 'Atacar con A → Gigs', group: 'atacar', src: unit(0), to: { z: 'g', side: 1 } },
  { label: 'Atacar con A → Meredith', group: 'atacar', src: unit(0), to: unit(2, 1) },
  { label: 'Atacar con B → Meredith', group: 'atacar', src: unit(1), to: unit(2, 1) },
  { label: 'Go Solo con Goro', group: 'legend', src: leg(1) },
  { label: 'Call (1 €)', group: 'legend', src: { z: 'lz', side: 0 } },
  { label: 'Habilidades fijas', group: 'habilidad' },
  { label: 'Terminar el turno', group: 'fin' },
]

describe('opciones por carta', () => {
  it('muestra solo las acciones de la carta seleccionada y conserva su posición', () => {
    const r = optionsFor(OPTIONS, hand('floor_it'))
    expect(r.map((o) => [o.option.label, o.index])).toEqual([['Vender Floor It', 0], ['Jugar Floor It', 1]])
    expect(optionsFor(OPTIONS, unit(0)).map((o) => o.index)).toEqual([3, 4])
    expect(optionsFor(OPTIONS, hand('nada'))).toEqual([])
    expect(optionsFor(OPTIONS, null)).toEqual([])
  })

  it('separa las acciones de zona (Call) y las generales', () => {
    expect(zoneOptions(OPTIONS, 'lz').map((o) => o.index)).toEqual([7])
    expect(globalOptions(OPTIONS).map((o) => o.option.label)).toEqual(['Habilidades fijas', 'Terminar el turno'])
  })

  it('resalta las cartas con acciones, sin contar el Call', () => {
    const keys = actorKeys(OPTIONS)
    expect(keys.has(refKey(hand('floor_it')))).toBe(true)
    expect(keys.has(refKey(unit(1)))).toBe(true)
    expect(keys.has(refKey(leg(1)))).toBe(true)
    expect([...keys].some((k) => k.startsWith('lz'))).toBe(false)
  })

  it('al elegir un objetivo, cada opción se corresponde con una carta del tablero', () => {
    const targets: PlayOption[] = [
      { label: 'Meredith', group: 'objetivo', ref: unit(2, 1) },
      { label: 'Corpo', group: 'objetivo', ref: unit(0, 1) },
    ]
    expect(candidateKeys(targets).size).toBe(2)
    expect(optionForRef(targets, unit(0, 1))?.index).toBe(1)
    expect(optionForRef(targets, unit(5, 1))).toBeNull()
  })
})

describe('arrastrar y soltar', () => {
  it('una carta de la mano: a la mesa se juega y a los Eddies se vende', () => {
    expect(dropOption(OPTIONS, hand('floor_it'), { z: 'field' })?.option.label).toBe('Jugar Floor It')
    expect(dropOption(OPTIONS, hand('floor_it'), { z: 'eddies' })?.option.label).toBe('Vender Floor It')
    expect(dropOption(OPTIONS, hand('psycho_squad'), { z: 'eddies' })).toBeNull() // las Unidades no se venden
  })

  it('soltar un Gear sobre una de tus Unidades lo juega (y la interfaz le contesta que se equipa a esa)', () => {
    expect(dropOption(OPTIONS, hand('floor_it'), { z: 'unit', side: 0, i: 1 })?.option.label).toBe('Jugar Floor It')
    expect(dropOption(OPTIONS, hand('floor_it'), { z: 'unit', side: 1, i: 1 })).toBeNull()
  })

  it('una Unidad ataca a los Gigs rivales o a la Unidad rival en la que se suelta', () => {
    expect(dropOption(OPTIONS, unit(0), { z: 'gigs', side: 1 })?.option.label).toBe('Atacar con A → Gigs')
    expect(dropOption(OPTIONS, unit(0), { z: 'unit', side: 1, i: 2 })?.option.label).toBe('Atacar con A → Meredith')
    expect(dropOption(OPTIONS, unit(1), { z: 'gigs', side: 1 })).toBeNull() // B no puede atacar a los Gigs
    expect(dropOption(OPTIONS, unit(0), { z: 'gigs', side: 0 })).toBeNull() // no se atacan los propios
    expect(dropOption(OPTIONS, unit(0), { z: 'field' })).toBeNull()
  })

  it('una Legend boca arriba soltada en la mesa hace Go Solo', () => {
    expect(dropOption(OPTIONS, leg(1), { z: 'field' })?.option.label).toBe('Go Solo con Goro')
    expect(dropOption(OPTIONS, leg(0), { z: 'field' })).toBeNull()
  })
})

describe('pagar con Legends concretas', () => {
  const pay: PlayOption[] = [
    { label: '2 Eddies + Wakako', group: 'pago', legs: [2], eddies: 2 },
    { label: '2 Eddies + Lucyna', group: 'pago', legs: [1], eddies: 2 },
    { label: '1 Eddie + Lucyna + Wakako', group: 'pago', legs: [1, 2], eddies: 1 },
  ]
  it('encuentra la opción de las Legends marcadas sin importar el orden', () => {
    expect(payOption(pay, [2])).toBe(0)
    expect(payOption(pay, [2, 1])).toBe(2)
    expect(payOption(pay, [0])).toBeNull()
    expect(payOption(pay, [])).toBeNull()
  })

  it('dice qué falta o sobra', () => {
    expect(payHint(pay, [2], 3, 2)).toBe('1 Legends + 2 Eddies sueltos')
    expect(payHint(pay, [], 3, 2)).toBe('Faltan 1 €: marca más Legends')
    expect(payHint(pay, [0, 1, 2, 3], 3, 2)).toBe('Sobran 1 Legends: solo se pagan 3 €')
    expect(payHint(pay, [0], 3, 2)).toBe('Esa combinación no es posible')
  })
})

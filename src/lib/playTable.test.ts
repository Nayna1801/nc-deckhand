import { describe, expect, it } from 'vitest'
import type { PlayOption } from './play'
import { actorKeys, candidateKeys, cardMenu, dropOption, globalOptions, optionForRef, optionsFor, payLimits, payOption, payPick, refKey, togglePay, zoneOptions } from './playTable'

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

describe('menú de una carta: acciones y subacciones', () => {
  it('atacar los Gigs es directo; atacar a una Unidad abre la lista de Unidades', () => {
    const menu = cardMenu(optionsFor(OPTIONS, unit(0)))
    expect(menu).toEqual([
      { kind: 'direct', index: 3, label: 'Atacar con A → Gigs' },
      { kind: 'sub', key: 'atacar-unidad', title: 'Atacar a una Unidad', items: [{ index: 4, label: 'Meredith', to: unit(2, 1) }] },
    ])
  })

  it('aunque solo haya una Unidad a la que atacar, no se elige sola', () => {
    const menu = cardMenu(optionsFor(OPTIONS, unit(1)))
    expect(menu).toHaveLength(1)
    expect(menu[0].kind).toBe('sub')
  })

  it('vender y jugar una carta son acciones distintas y directas', () => {
    expect(cardMenu(optionsFor(OPTIONS, hand('floor_it'))).map((m) => m.kind)).toEqual(['direct', 'direct'])
  })

  it('varias habilidades de la misma carta se agrupan en una acción con su lista', () => {
    const alt: PlayOption[] = [
      { label: 'Alt: gastarla', group: 'habilidad', src: leg(0) },
      { label: 'Alt: jugar Trust No One', group: 'habilidad', src: leg(0) },
      { label: 'Go Solo con Alt', group: 'legend', src: leg(0) },
    ]
    const menu = cardMenu(optionsFor(alt, leg(0)))
    expect(menu.map((m) => (m.kind === 'sub' ? [m.title, m.items.map((i) => i.index)] : m.label))).toEqual([['Habilidades', [0, 1]], 'Go Solo con Alt'])
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

  it('y sobre una de tus Legends boca arriba, igual', () => {
    expect(dropOption(OPTIONS, hand('floor_it'), { z: 'legend', side: 0, i: 2 })?.option.label).toBe('Jugar Floor It')
    expect(dropOption(OPTIONS, hand('floor_it'), { z: 'legend', side: 1, i: 2 })).toBeNull()
    expect(dropOption(OPTIONS, unit(0), { z: 'legend', side: 0, i: 2 })).toBeNull()
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

  it('sabe con qué Legends y con cuántos Eddies sueltos se puede pagar', () => {
    const lim = payLimits(pay)
    expect([...lim.legs].sort()).toEqual([1, 2])
    expect(lim.eddies).toBe(2)
  })

  it('tocando Eddies y Legends se marca lo que se gasta, y al llegar al precio sale la opción', () => {
    let m = { legs: [] as number[], eddies: [] as number[] }
    m = togglePay(pay, m, 'l', 2, 3)
    expect(payPick(pay, m, 3)).toBeNull() // falta por marcar
    m = togglePay(pay, m, 'e', 0, 3)
    m = togglePay(pay, m, 'e', 3, 3)
    expect(m).toEqual({ legs: [2], eddies: [0, 3] })
    expect(payPick(pay, m, 3)).toBe(0) // Wakako + 2 Eddies
    expect(payPick(pay, { legs: [1, 2], eddies: [1] }, 3)).toBe(2)
  })

  it('no deja marcar lo que no vale ni pasarse del precio, y un segundo toque desmarca', () => {
    const none = { legs: [], eddies: [] }
    expect(togglePay(pay, none, 'l', 0, 3)).toBe(none) // esa Legend no puede pagar (gastada o reservada)
    const two = { legs: [], eddies: [0, 1] }
    expect(togglePay(pay, two, 'e', 2, 3)).toBe(two) // solo hay 2 Eddies preparados
    const full = { legs: [1, 2], eddies: [0] }
    expect(togglePay(pay, full, 'e', 1, 3)).toBe(full) // ya están los 3 €
    expect(togglePay(pay, full, 'l', 1, 3)).toEqual({ legs: [2], eddies: [0] })
    expect(togglePay(pay, full, 'e', 0, 3)).toEqual({ legs: [1, 2], eddies: [] })
    expect(payPick(pay, { legs: [], eddies: [0, 1, 2] }, 3)).toBeNull() // 3 Eddies sueltos no es una opción
  })
})

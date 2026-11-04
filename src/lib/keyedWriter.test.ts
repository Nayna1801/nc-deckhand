import { describe, expect, it } from 'vitest'
import { createKeyedWriter } from './keyedWriter'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** "Servidor" que tarda un tiempo distinto en cada petición (como una red real) y aplica según LLEGA. */
function fakeServer(delays: number[]) {
  const applied: { key: string; value: number }[] = []
  const state: Record<string, number> = {}
  let call = 0
  return {
    applied,
    state,
    persist: async (key: string, value: number) => {
      const d = delays[call++ % delays.length]
      await sleep(d)
      applied.push({ key, value })
      state[key] = value
    },
  }
}

describe('createKeyedWriter', () => {
  it('SIN cola, un valor viejo puede llegar el último (el fallo que se corrige)', async () => {
    const s = fakeServer([60, 5, 30])
    await Promise.all([1, 2, 3].map((v) => s.persist('a', v)))
    expect(s.state.a).not.toBe(3) // la red desordena: queda un valor antiguo
  })

  it('CON cola, el servidor siempre acaba con el ÚLTIMO valor aunque la red desordene', async () => {
    const s = fakeServer([60, 5, 30, 15, 45])
    const w = createKeyedWriter(s.persist)
    for (const v of [1, 2, 3, 4, 5, 6]) void w.write('a', v)
    await w.idle()
    expect(s.state.a).toBe(6)
  })

  it('las escrituras de una misma clave nunca se solapan y llegan en orden', async () => {
    let running = 0
    let maxRunning = 0
    const order: number[] = []
    const w = createKeyedWriter(async (_k: string, v: number) => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await sleep(10)
      order.push(v)
      running--
    })
    for (let v = 1; v <= 8; v++) void w.write('a', v)
    await w.idle()
    expect(maxRunning).toBe(1)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.at(-1)).toBe(8)
  })

  it('agrupa: si se acumulan varias solo se envía la última (menos peticiones)', async () => {
    const s = fakeServer([20])
    const w = createKeyedWriter(s.persist)
    for (let v = 1; v <= 10; v++) void w.write('a', v)
    await w.idle()
    expect(s.applied.length).toBeLessThan(10)
    expect(s.applied.at(-1)?.value).toBe(10)
  })

  it('claves distintas se envían en paralelo y no se bloquean entre sí', async () => {
    let running = 0
    let maxRunning = 0
    const w = createKeyedWriter(async () => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await sleep(30)
      running--
    })
    void w.write('a', 1)
    void w.write('b', 1)
    void w.write('c', 1)
    await w.idle()
    expect(maxRunning).toBe(3)
  })

  it('un fallo se comunica a quien lo causó y no bloquea las escrituras siguientes', async () => {
    const saved: number[] = []
    let n = 0
    const w = createKeyedWriter(async (_k: string, v: number) => {
      if (n++ === 0) throw new Error('red caída')
      saved.push(v)
    })
    await expect(w.write('a', 1)).rejects.toThrow('red caída')
    await w.write('a', 2)
    expect(saved).toEqual([2])
  })

  it('idle() espera a todo lo pendiente y no falla aunque haya errores', async () => {
    const w = createKeyedWriter(async () => {
      await sleep(10)
      throw new Error('x')
    })
    void w.write('a', 1).catch(() => undefined)
    await expect(w.idle()).resolves.toBeUndefined()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { dataErrorMessage } from './dataErrors'
import { fetchWithJwtRetry } from './retryFetch'

const future = () => new Response(JSON.stringify({ code: 'PGRST303', details: null, hint: null, message: 'JWT issued at future' }), { status: 401, headers: { 'content-type': 'application/json' } })
const ok = (body = '[]') => new Response(body, { status: 200 })
const noWait = vi.fn(async () => undefined)

describe('reintento de «JWT issued at future»', () => {
  it('repite la petición y devuelve la respuesta buena cuando el servidor ya acepta el token', async () => {
    const base = vi.fn().mockResolvedValueOnce(future()).mockResolvedValueOnce(future()).mockResolvedValueOnce(ok('[1]'))
    const res = await fetchWithJwtRetry('https://x/y', { method: 'POST', body: '{"a":1}' }, base, [1, 2, 3], noWait)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('[1]')
    expect(base).toHaveBeenCalledTimes(3)
    // la misma petición cada vez (misma URL, método y cuerpo)
    for (const call of base.mock.calls) expect(call).toEqual(['https://x/y', { method: 'POST', body: '{"a":1}' }])
  })

  it('espera entre intentos con las pausas indicadas', async () => {
    const waits: number[] = []
    const base = vi.fn().mockResolvedValueOnce(future()).mockResolvedValueOnce(future()).mockResolvedValueOnce(ok())
    await fetchWithJwtRetry('u', undefined, base, [10, 20, 30], async (ms) => void waits.push(ms))
    expect(waits).toEqual([10, 20])
  })

  it('si sigue fallando, tras los reintentos devuelve ese mismo 401 (no se queda en bucle)', async () => {
    const base = vi.fn().mockImplementation(async () => future())
    const res = await fetchWithJwtRetry('u', undefined, base, [1, 2, 3], noWait)
    expect(res.status).toBe(401)
    expect(base).toHaveBeenCalledTimes(4) // 1 + 3 reintentos
  })

  it('no reintenta respuestas buenas ni otros errores', async () => {
    const good = vi.fn().mockResolvedValue(ok())
    expect((await fetchWithJwtRetry('u', undefined, good, [1, 1], noWait)).status).toBe(200)
    expect(good).toHaveBeenCalledTimes(1)

    const expired = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'PGRST301', message: 'JWT expired' }), { status: 401 }))
    expect((await fetchWithJwtRetry('u', undefined, expired, [1, 1], noWait)).status).toBe(401)
    expect(expired).toHaveBeenCalledTimes(1)

    const server = vi.fn().mockResolvedValue(new Response('{"code":"PGRST303"}', { status: 500 }))
    await fetchWithJwtRetry('u', undefined, server, [1, 1], noWait)
    expect(server).toHaveBeenCalledTimes(1) // solo cuenta un 401

    const notJson = vi.fn().mockResolvedValue(new Response('<html>no autorizado</html>', { status: 401 }))
    expect((await fetchWithJwtRetry('u', undefined, notJson, [1, 1], noWait)).status).toBe(401)
    expect(notJson).toHaveBeenCalledTimes(1)
  })

  it('el cuerpo de la respuesta devuelta sigue siendo legible (no se consume al comprobarla)', async () => {
    const base = vi.fn().mockResolvedValueOnce(future())
    const res = await fetchWithJwtRetry('u', undefined, base, [], noWait)
    expect(res.status).toBe(401)
    expect(((await res.json()) as { code: string }).code).toBe('PGRST303')
  })

  it('un fallo de red se propaga tal cual (no se reintenta a ciegas)', async () => {
    const base = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchWithJwtRetry('u', undefined, base, [1, 1], noWait)).rejects.toThrow('Failed to fetch')
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('también reconoce el error por su texto si no viene el código', async () => {
    const base = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ message: 'JWT issued at future' }), { status: 401 })).mockResolvedValueOnce(ok())
    expect((await fetchWithJwtRetry('u', undefined, base, [1], noWait)).status).toBe(200)
  })
})

describe('mensajes de error de datos', () => {
  it('«JWT issued at future» sale en español y sin el texto del servidor', () => {
    for (const e of [{ code: 'PGRST303', message: 'JWT issued at future' }, new Error('JWT issued at future'), { message: 'jwt issued at future' }]) {
      const m = dataErrorMessage(e, 'x')
      expect(m).toMatch(/sesión se acaba de renovar/)
      expect(m).not.toMatch(/JWT|future/i)
    }
  })

  it('sesión caducada y falta de conexión tienen su mensaje', () => {
    expect(dataErrorMessage({ code: 'PGRST301', message: 'JWT expired' }, 'x')).toMatch(/caducado/)
    expect(dataErrorMessage(new TypeError('Failed to fetch'), 'x')).toMatch(/No se pudo conectar/)
  })

  it('cualquier otro error usa el texto de reserva y nunca el del servidor', () => {
    expect(dataErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "x"' }, 'No se pudo guardar.')).toBe('No se pudo guardar.')
    expect(dataErrorMessage(null, 'No se pudo guardar.')).toBe('No se pudo guardar.')
    expect(dataErrorMessage(undefined, 'No se pudo guardar.')).toBe('No se pudo guardar.')
    expect(dataErrorMessage('texto raro', 'No se pudo guardar.')).toBe('No se pudo guardar.')
    expect(dataErrorMessage({ message: 42 }, 'No se pudo guardar.')).toBe('No se pudo guardar.')
  })
})

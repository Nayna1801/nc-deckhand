import { describe, expect, it } from 'vitest'
import { emptyAlbum, stampOf, type Album, type AlbumSlot } from './album'
import { fetchRemoteAlbum, hasContent, isMissingTable, pickNewer, pushRemoteAlbum, type AlbumClient } from './albumSync'

const valid = (s: AlbumSlot) => s.print !== 'mala'
const exists = (id: string) => id !== 'borrada'

interface Fake {
  client: AlbumClient
  upserts: Record<string, unknown>[]
  asked: { table: string; column: string; value: string }[]
}

/** Cliente falso: `select` devuelve lo indicado y `upsert` apunta lo que recibe. */
function fake(opts: { data?: unknown; error?: unknown; upsertError?: unknown; throws?: boolean }): Fake {
  const out: Fake = { upserts: [], asked: [], client: undefined as unknown as AlbumClient }
  out.client = {
    from: (table) => ({
      select: () => ({
        eq: (column, value) => ({
          limit: async () => {
            out.asked.push({ table, column, value })
            if (opts.throws) throw new Error('Failed to fetch')
            return { data: opts.data ?? [], error: opts.error ?? null }
          },
        }),
      }),
      upsert: async (row) => {
        out.upserts.push(row)
        if (opts.throws) throw new Error('Failed to fetch')
        return { error: opts.upsertError ?? null }
      },
    }),
  }
  return out
}

const album = (slots: (AlbumSlot | null)[], updatedAt?: number): Album => ({ name: 'T', perPage: 9, slots, ...(updatedAt ? { updatedAt } : {}) })

describe('qué copia del álbum se queda', () => {
  it('gana la más reciente; sin copia en la cuenta, la local; a igualdad, ninguna', () => {
    expect(pickNewer(10, null)).toBe('local')
    expect(pickNewer(10, 20)).toBe('remote')
    expect(pickNewer(20, 10)).toBe('local')
    expect(pickNewer(10, 10)).toBe('same')
    expect(pickNewer(0, 5)).toBe('remote') // un álbum local antiguo (sin marca) no pisa el de la cuenta
  })

  it('un álbum se sube si se tocó alguna vez o tiene cartas; uno recién creado no', () => {
    expect(hasContent(emptyAlbum())).toBe(false)
    expect(hasContent(album([null, { card: 'a' }]))).toBe(true)
    expect(hasContent(album([], 5))).toBe(true)
    expect(stampOf(album([]))).toBe(0)
  })
})

describe('leer el álbum de la cuenta', () => {
  it('sin fila devuelve «sin álbum» y pregunta solo por la fila del usuario', async () => {
    const f = fake({ data: [] })
    expect(await fetchRemoteAlbum(f.client, 'u1', valid, exists)).toEqual({ kind: 'ok', album: null })
    expect(f.asked).toEqual([{ table: 'tcg_album', column: 'user_id', value: 'u1' }])
  })

  it('con fila lo recupera limpiando lo inválido (carta borrada, impresión mala) y conserva la marca de tiempo', async () => {
    const data = [{ data: { name: 'Mía', perPage: 4, updatedAt: 1234, slots: [{ card: 'a', print: 'ok' }, { card: 'borrada' }, { card: 'b', print: 'mala' }, 7] } }]
    const r = await fetchRemoteAlbum(fake({ data }).client, 'u1', valid, exists)
    expect(r).toEqual({ kind: 'ok', album: { name: 'Mía', perPage: 4, updatedAt: 1234, slots: [{ card: 'a', print: 'ok' }, null, { card: 'b' }, null] } })
  })

  it('datos corruptos en la cuenta no rompen: álbum vacío', async () => {
    const r = await fetchRemoteAlbum(fake({ data: [{ data: 'no soy un objeto' }] }).client, 'u1', valid, exists)
    expect(r).toEqual({ kind: 'ok', album: emptyAlbum() })
  })

  it('si la tabla no existe lo dice, y si falla la red da un mensaje propio en español (nunca el del servidor)', async () => {
    expect(await fetchRemoteAlbum(fake({ error: { code: 'PGRST205', message: "Could not find the table 'public.tcg_album' in the schema cache" } }).client, 'u1', valid, exists)).toEqual({ kind: 'missing' })
    expect(await fetchRemoteAlbum(fake({ error: { code: '42P01', message: 'relation "tcg_album" does not exist' } }).client, 'u1', valid, exists)).toEqual({ kind: 'missing' })
    const net = await fetchRemoteAlbum(fake({ throws: true }).client, 'u1', valid, exists)
    expect(net.kind).toBe('error')
    expect(net.kind === 'error' && net.message).toMatch(/conectar/i)
    const other = await fetchRemoteAlbum(fake({ error: { code: 'XX000', message: 'internal secret detail' } }).client, 'u1', valid, exists)
    expect(other.kind === 'error' && other.message).not.toMatch(/secret/)
  })

  it('reconoce los errores de «tabla inexistente» y no confunde otros', () => {
    expect(isMissingTable({ code: 'PGRST205' })).toBe(true)
    expect(isMissingTable({ message: 'relation "public.tcg_album" does not exist' })).toBe(true)
    expect(isMissingTable({ code: 'PGRST303', message: 'JWT issued at future' })).toBe(false)
    expect(isMissingTable(null)).toBe(false)
  })
})

describe('subir el álbum a la cuenta', () => {
  it('hace upsert de la fila del usuario con el álbum entero y su marca de tiempo', async () => {
    const f = fake({})
    const a = album([{ card: 'a' }], 5000)
    expect(await pushRemoteAlbum(f.client, 'u1', a)).toEqual({ kind: 'ok' })
    expect(f.upserts).toHaveLength(1)
    expect(f.upserts[0]).toMatchObject({ user_id: 'u1', data: { name: 'T', perPage: 9, updatedAt: 5000, slots: [{ card: 'a' }] }, updated_at: new Date(5000).toISOString() })
  })

  it('un álbum sin marca recibe una al subirse', async () => {
    const f = fake({})
    await pushRemoteAlbum(f.client, 'u1', album([{ card: 'a' }]))
    expect((f.upserts[0].data as Album).updatedAt).toBeGreaterThan(0)
  })

  it('devuelve «missing» si no hay tabla y el mensaje propio si falla', async () => {
    expect(await pushRemoteAlbum(fake({ upsertError: { code: 'PGRST205', message: 'schema cache' } }).client, 'u1', emptyAlbum())).toEqual({ kind: 'missing' })
    const r = await pushRemoteAlbum(fake({ throws: true }).client, 'u1', emptyAlbum())
    expect(r.kind === 'error' && r.message).toMatch(/conectar/i)
  })
})

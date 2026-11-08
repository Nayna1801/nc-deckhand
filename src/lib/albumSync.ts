import { sanitizeAlbum, stampOf, type Album, type AlbumSlot } from './album'
import { dataErrorMessage } from './dataErrors'

/**
 * Sincronización del álbum con la cuenta (tabla `tcg_album`, una fila por usuario con el álbum entero en `data`).
 * Gana la copia modificada más recientemente (`updatedAt`): sencillo y suficiente para un álbum que edita una sola persona.
 * Si la tabla no existe (no se ha vuelto a ejecutar schema.sql) o hay un error, el álbum sigue funcionando en este navegador.
 */

/** Lo mínimo que se usa del cliente de Supabase (así se puede probar con uno falso). */
export interface AlbumClient {
  from(table: 'tcg_album'): {
    select(columns: string): { eq(column: string, value: string): { limit(n: number): PromiseLike<{ data: unknown; error: unknown }> } }
    upsert(row: Record<string, unknown>): PromiseLike<{ error: unknown }>
  }
}

export type RemoteAlbum = { kind: 'ok'; album: Album | null } | { kind: 'missing' } | { kind: 'error'; message: string }

interface ErrorLike {
  code?: unknown
  message?: unknown
  status?: unknown
}

/** La tabla todavía no existe en el servidor. */
export function isMissingTable(e: unknown): boolean {
  const err = (typeof e === 'object' && e !== null ? e : {}) as ErrorLike
  const message = typeof err.message === 'string' ? err.message : ''
  return err.code === 'PGRST205' || err.code === '42P01' || /tcg_album|schema cache|does not exist|relation/i.test(message)
}

const FALLBACK = 'No se pudo sincronizar el álbum con tu cuenta. Se sigue guardando en este navegador.'

/** Lee el álbum de la cuenta (null si aún no hay ninguno). */
export async function fetchRemoteAlbum(client: AlbumClient, userId: string, valid: (s: AlbumSlot) => boolean, cardExists: (id: string) => boolean): Promise<RemoteAlbum> {
  try {
    const { data, error } = await client.from('tcg_album').select('data, updated_at').eq('user_id', userId).limit(1)
    if (error) return isMissingTable(error) ? { kind: 'missing' } : { kind: 'error', message: dataErrorMessage(error, FALLBACK) }
    const row = Array.isArray(data) ? (data[0] as { data?: unknown } | undefined) : undefined
    if (!row) return { kind: 'ok', album: null }
    return { kind: 'ok', album: sanitizeAlbum(row.data, valid, cardExists) }
  } catch (e) {
    return { kind: 'error', message: dataErrorMessage(e, FALLBACK) }
  }
}

/** Guarda el álbum en la cuenta (sustituye al anterior). Devuelve el error ya traducido, o null si fue bien. */
export async function pushRemoteAlbum(client: AlbumClient, userId: string, album: Album): Promise<{ kind: 'ok' } | { kind: 'missing' } | { kind: 'error'; message: string }> {
  try {
    const stamp = stampOf(album) || Date.now()
    const { error } = await client.from('tcg_album').upsert({ user_id: userId, data: { ...album, updatedAt: stamp }, updated_at: new Date(stamp).toISOString() })
    if (!error) return { kind: 'ok' }
    return isMissingTable(error) ? { kind: 'missing' } : { kind: 'error', message: dataErrorMessage(error, FALLBACK) }
  } catch (e) {
    return { kind: 'error', message: dataErrorMessage(e, FALLBACK) }
  }
}

/** Qué copia se queda al juntar la local con la de la cuenta. */
export function pickNewer(localStamp: number, remoteStamp: number | null): 'local' | 'remote' | 'same' {
  if (remoteStamp === null) return 'local'
  if (remoteStamp > localStamp) return 'remote'
  return remoteStamp < localStamp ? 'local' : 'same'
}

/** Un álbum merece subirse si se ha tocado alguna vez o tiene cartas colocadas. */
export const hasContent = (a: Album): boolean => stampOf(a) > 0 || a.slots.some(Boolean)

import { useCallback, useEffect, useRef, useState } from 'react'
import { catalog } from '../lib/catalog'
import { albumKey, loadAlbum, saveAlbum, stampOf, type Album, type AlbumSlot } from '../lib/album'
import { fetchRemoteAlbum, hasContent, pickNewer, pushRemoteAlbum, type AlbumClient } from '../lib/albumSync'
import { printsOf } from '../lib/prints'
import { supabase } from '../lib/supabase'

const cardExists = (id: string): boolean => id in catalog.byId
const printValid = (s: AlbumSlot): boolean => {
  const card = catalog.byId[s.card]
  return !!card && printsOf(card).some((p) => p.key === s.print)
}
const load = (key: string): Album => loadAlbum(key, printValid, cardExists)

/** Cuánto se espera tras el último cambio antes de subir el álbum (así un arrastre o una racha de cambios hace una sola subida). */
const PUSH_DELAY_MS = 800

export type SyncState = 'local' | 'loading' | 'saving' | 'synced' | 'missing' | 'error'
export interface AlbumSyncStatus {
  state: SyncState
  message?: string
}

/**
 * El álbum de un usuario. Siempre se guarda en este navegador (clave propia por cuenta) y, con sesión, también en su
 * cuenta (tabla `tcg_album`) para que se vea igual en todos sus dispositivos. Gana la copia más reciente.
 */
export function useAlbum(userId: string | null | undefined, client: AlbumClient | null = supabase as unknown as AlbumClient | null) {
  const key = albumKey(userId)
  const [state, setState] = useState(() => ({ key, album: load(key) }))
  const album = state.key === key ? state.album : load(key)
  const [status, setStatus] = useState<AlbumSyncStatus>({ state: client && userId ? 'loading' : 'local' })
  const [attempt, setAttempt] = useState(0)

  const latest = useRef(album)
  latest.current = album
  const remoteReady = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const dirty = useRef(false)
  const alive = useRef(true)

  useEffect(() => {
    if (state.key !== key) setState({ key, album })
  }, [state.key, key, album])

  const push = useCallback(
    async (a: Album) => {
      if (!client || !userId) return
      dirty.current = false
      if (alive.current) setStatus({ state: 'saving' })
      const r = await pushRemoteAlbum(client, userId, a)
      if (!alive.current) return
      if (r.kind === 'ok') setStatus((s) => (dirty.current ? s : { state: 'synced' }))
      else {
        dirty.current = true // se vuelve a intentar con el siguiente cambio
        setStatus(r.kind === 'missing' ? { state: 'missing' } : { state: 'error', message: r.message })
      }
    },
    [client, userId],
  )

  // al entrar (o al reintentar): se junta la copia de este navegador con la de la cuenta y gana la más reciente
  useEffect(() => {
    remoteReady.current = false
    if (!client || !userId) {
      setStatus({ state: 'local' })
      return
    }
    let current = true
    setStatus({ state: 'loading' })
    void (async () => {
      const r = await fetchRemoteAlbum(client, userId, printValid, cardExists)
      if (!current) return
      if (r.kind === 'missing') return setStatus({ state: 'missing' })
      if (r.kind === 'error') return setStatus({ state: 'error', message: r.message })
      const local = latest.current
      const winner = pickNewer(stampOf(local), r.album ? stampOf(r.album) : null)
      if (winner === 'remote' && r.album) {
        saveAlbum(key, r.album)
        setState({ key, album: r.album })
      } else if (winner === 'local' && hasContent(local)) {
        const done = await pushRemoteAlbum(client, userId, local)
        if (!current) return
        if (done.kind !== 'ok') return setStatus(done.kind === 'missing' ? { state: 'missing' } : { state: 'error', message: done.message })
      }
      remoteReady.current = true
      setStatus({ state: 'synced' })
    })()
    return () => {
      current = false
    }
  }, [client, userId, key, attempt])

  const update = useCallback(
    (fn: (a: Album) => Album) => {
      const stamp = Math.max(Date.now(), stampOf(latest.current) + 1)
      setState((prev) => {
        const next = { ...fn(prev.key === key ? prev.album : load(key)), updatedAt: stamp }
        saveAlbum(key, next)
        latest.current = next
        return { key, album: next }
      })
      if (!client || !userId || !remoteReady.current) return
      dirty.current = true
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void push(latest.current), PUSH_DELAY_MS)
    },
    [key, client, userId, push],
  )

  // al salir de la pantalla con cambios sin subir, se suben ya
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      window.clearTimeout(timer.current)
      if (dirty.current && remoteReady.current && client && userId) void pushRemoteAlbum(client, userId, latest.current)
    }
  }, [client, userId])

  const retry = useCallback(() => {
    if (status.state === 'error' && remoteReady.current && dirty.current) void push(latest.current)
    else setAttempt((n) => n + 1)
  }, [status.state, push])

  return { album, update, status, retry }
}

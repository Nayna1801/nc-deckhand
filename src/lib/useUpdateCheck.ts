import { useEffect, useState } from 'react'

const CHECK_EVERY_MS = 10 * 60 * 1000

/**
 * ¿Hay publicada una versión más nueva que la que tiene cargada esta pestaña?
 * Una web de una sola página no se actualiza sola mientras sigue abierta (y GitHub Pages guarda los ficheros
 * 10 minutos en caché), así que se consulta version.json —sin caché— al abrir, al volver a la pestaña y cada 10 min.
 */
export function useUpdateAvailable(current: string = __APP_VERSION__): boolean {
  const [stale, setStale] = useState(false)

  useEffect(() => {
    if (current === 'dev') return // en desarrollo no existe version.json
    let active = true
    const check = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json?ts=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const data: unknown = await res.json()
        const latest = typeof data === 'object' && data !== null ? (data as { version?: unknown }).version : undefined
        if (active && typeof latest === 'string' && latest !== current) setStale(true)
      } catch {
        // sin red o sin version.json: no se avisa de nada
      }
    }
    void check()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [current])

  return stale
}

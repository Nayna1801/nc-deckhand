/**
 * Mensajes en español para los errores al leer o guardar datos. Igual que en el acceso, los textos son SIEMPRE
 * los nuestros: nunca se enseña tal cual lo que devuelve el servidor (suele venir en inglés y con detalles técnicos).
 */

const TEXT = {
  clock: 'Tu sesión se acaba de renovar y el servidor aún no la acepta. Espera unos segundos y recarga la página.',
  expired: 'Tu sesión ha caducado. Cierra sesión y vuelve a entrar.',
  network: 'No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.',
} as const

interface ErrorLike {
  code?: unknown
  message?: unknown
  name?: unknown
}

export function dataErrorMessage(e: unknown, fallback: string): string {
  const err = (typeof e === 'object' && e !== null ? e : {}) as ErrorLike
  const code = typeof err.code === 'string' ? err.code : ''
  const message = typeof err.message === 'string' ? err.message : ''
  if (code === 'PGRST303' || /jwt issued at future/i.test(message)) return TEXT.clock
  if (code === 'PGRST301' || /jwt expired/i.test(message)) return TEXT.expired
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) return TEXT.network
  return fallback
}

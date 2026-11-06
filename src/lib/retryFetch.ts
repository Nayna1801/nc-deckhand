/**
 * Reintento de peticiones rechazadas con «JWT issued at future» (PGRST303).
 *
 * Justo después de renovar el token (por ejemplo al recargar la página), el servidor de datos a veces cree que
 * la hora de emisión del token todavía no ha llegado, porque sus relojes van unos milisegundos desfasados, y
 * rechaza la petición con un 401. El servidor lo rechaza ANTES de ejecutar nada, así que repetirla es seguro
 * (también con escrituras), y casi siempre funciona un momento después con el mismo token.
 */

/** Esperas entre reintentos, en milisegundos (en total, unos 4 s como máximo). */
export const JWT_RETRY_DELAYS_MS: readonly number[] = [600, 1200, 2400]

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** ¿Es la respuesta de «token emitido en el futuro»? Solo mira un 401 y no consume la respuesta original. */
async function isJwtFuture(res: Response): Promise<boolean> {
  if (res.status !== 401) return false
  try {
    const body = (await res.clone().json()) as { code?: unknown; message?: unknown } | null
    return body?.code === 'PGRST303' || (typeof body?.message === 'string' && /jwt issued at future/i.test(body.message))
  } catch {
    return false
  }
}

export async function fetchWithJwtRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  base: FetchLike = (i, o) => fetch(i, o),
  delays: readonly number[] = JWT_RETRY_DELAYS_MS,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<Response> {
  let res = await base(input, init)
  for (const delay of delays) {
    if (!(await isJwtFuture(res))) return res
    await wait(delay)
    res = await base(input, init)
  }
  return res
}

/**
 * «Memoria» de la ventana para elegir carta del álbum: al volver a abrirla se queda donde estabas (búsqueda,
 * filtros, página de resultados y posición del scroll) en vez de empezar siempre arriba en la primera página.
 * Se guarda en la sesión del navegador (sobrevive a recargar, no a cerrar la pestaña).
 */

export interface PickerMemory {
  q: string
  /** null = todavía no se ha tocado: la ventana usa su valor por defecto (solo las que tengo, si hay sesión). */
  onlyOwned: boolean | null
  onlyArts: boolean
  /** Página de resultados (1-based). */
  page: number
  /** Posición del scroll dentro de la ventana, en píxeles. */
  scroll: number
}

export const EMPTY_PICKER_MEMORY: PickerMemory = { q: '', onlyOwned: null, onlyArts: false, page: 1, scroll: 0 }

export const PICKER_MEMORY_KEY = 'ncd.album.picker.v1'
const MAX_Q = 120
const MAX_PAGE = 1000
const MAX_SCROLL = 1_000_000

/** Valida lo leído del navegador: valores fuera de rango o de otro tipo vuelven a su valor por defecto. */
export function sanitizePickerMemory(raw: unknown): PickerMemory {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_PICKER_MEMORY
  const r = raw as Record<string, unknown>
  const int = (v: unknown, min: number, max: number, fallback: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback
    return Math.min(Math.max(n, min), max)
  }
  return {
    q: typeof r.q === 'string' ? r.q.slice(0, MAX_Q) : '',
    onlyOwned: typeof r.onlyOwned === 'boolean' ? r.onlyOwned : null,
    onlyArts: r.onlyArts === true,
    page: int(r.page, 1, MAX_PAGE, 1),
    scroll: int(r.scroll, 0, MAX_SCROLL, 0),
  }
}

function session(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

export function loadPickerMemory(storage: Pick<Storage, 'getItem'> | undefined = session()): PickerMemory {
  try {
    const text = storage?.getItem(PICKER_MEMORY_KEY)
    return text ? sanitizePickerMemory(JSON.parse(text)) : EMPTY_PICKER_MEMORY
  } catch {
    return EMPTY_PICKER_MEMORY
  }
}

export function savePickerMemory(m: PickerMemory, storage: Pick<Storage, 'setItem'> | undefined = session()): boolean {
  try {
    if (!storage) return false
    storage.setItem(PICKER_MEMORY_KEY, JSON.stringify(sanitizePickerMemory(m)))
    return true
  } catch {
    return false
  }
}

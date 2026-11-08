/**
 * Álbum de cartas: un archivador virtual con páginas de bolsillos (2×2, 3×3 o 4×3) donde el usuario coloca
 * las cartas que quiere enseñar, en el orden que quiera y con la impresión (arte) que prefiera.
 * Es solo lógica: lo que se guarda es una lista lineal de bolsillos (`slots`), y las páginas salen de partirla.
 */

/** Una carta colocada en un bolsillo; `print` es la clave de impresión (`PrintEntry.key`) si se eligió un arte concreto. */
export interface AlbumSlot {
  card: string
  print?: string
}

export type PerPage = 4 | 9 | 12
export const PAGE_SIZES: readonly PerPage[] = [4, 9, 12]
export const DEFAULT_PER_PAGE: PerPage = 9
/** Tope de bolsillos: protege el navegador y lo guardado de listas desmesuradas. */
export const MAX_SLOTS = 1200
export const MAX_NAME = 40

export interface Album {
  name: string
  perPage: PerPage
  /** Bolsillos en orden; null = bolsillo vacío. */
  slots: (AlbumSlot | null)[]
  /** Momento (ms) de la última modificación: decide qué copia gana al sincronizar con la cuenta. Ausente = nunca modificado. */
  updatedAt?: number
}

/** Marca de tiempo de un álbum (0 si no tiene). */
export const stampOf = (a: Pick<Album, 'updatedAt'>): number => (typeof a.updatedAt === 'number' && a.updatedAt > 0 ? a.updatedAt : 0)

export const emptyAlbum = (): Album => ({ name: 'Mi álbum', perPage: DEFAULT_PER_PAGE, slots: [] })

/** Columnas de la rejilla de una página (la de 12 es de 4 columnas por 3 filas). */
export const columnsOf = (perPage: PerPage): number => (perPage === 4 ? 2 : perPage === 9 ? 3 : 4)

/** Páginas del álbum; siempre hay al menos una. */
export const pageCount = (a: Album): number => Math.max(1, Math.ceil(a.slots.length / a.perPage))

/** Bolsillos de una página (0-based), rellenados con huecos hasta completarla. */
export function pageSlots(a: Album, page: number): (AlbumSlot | null)[] {
  const p = Math.min(Math.max(0, Math.floor(page) || 0), pageCount(a) - 1)
  const slice = a.slots.slice(p * a.perPage, (p + 1) * a.perPage)
  return [...slice, ...Array<null>(a.perPage - slice.length).fill(null)]
}

/** Posición global del bolsillo `i` de la página `page`. */
export const slotIndex = (a: Album, page: number, i: number): number => page * a.perPage + i

const pad = (slots: (AlbumSlot | null)[], length: number): (AlbumSlot | null)[] =>
  slots.length >= length ? slots : [...slots, ...Array<null>(length - slots.length).fill(null)]

const clampIndex = (i: number): number => Math.min(Math.max(0, Math.floor(i) || 0), MAX_SLOTS - 1)

/** Pone (o quita, con null) una carta en el bolsillo `index`. Si el bolsillo está más allá del final, se crean los huecos intermedios. */
export function setSlot(a: Album, index: number, slot: AlbumSlot | null): Album {
  const i = clampIndex(index)
  const slots = pad([...a.slots], i + 1)
  slots[i] = slot
  return { ...a, slots }
}

/** Quita el bolsillo `index` (los siguientes suben una posición). */
export function removeSlot(a: Album, index: number): Album {
  if (index < 0 || index >= a.slots.length) return a
  return { ...a, slots: a.slots.filter((_, i) => i !== index) }
}

/** Mete un bolsillo vacío en `index` (los siguientes bajan una posición). */
export function insertSlot(a: Album, index: number): Album {
  if (a.slots.length >= MAX_SLOTS) return a
  const i = Math.min(Math.max(0, Math.floor(index) || 0), a.slots.length)
  const slots = [...a.slots]
  slots.splice(i, 0, null)
  return { ...a, slots }
}

/** Intercambia el contenido de dos bolsillos (también con uno vacío o fuera de lo escrito). */
export function swapSlots(a: Album, i: number, j: number): Album {
  if (i === j) return a
  const hi = clampIndex(Math.max(i, j))
  const slots = pad([...a.slots], hi + 1)
  const tmp = slots[i]
  slots[i] = slots[j]
  slots[j] = tmp
  return { ...a, slots }
}

/** Añade una página vacía al final (completando antes la última, para que empiece en una página nueva). */
export function addPage(a: Album): Album {
  const full = Math.ceil(a.slots.length / a.perPage) * a.perPage
  const target = Math.min(MAX_SLOTS, full + a.perPage)
  return target <= a.slots.length ? a : { ...a, slots: pad([...a.slots], target) }
}

/** Quita una página entera (sus bolsillos y su contenido). Siempre queda una. */
export function removePage(a: Album, page: number): Album {
  if (pageCount(a) <= 1 || page < 0 || page >= pageCount(a)) return a
  return { ...a, slots: a.slots.filter((_, i) => Math.floor(i / a.perPage) !== page) }
}

/** Cambia cuántas cartas caben por página; el contenido conserva su orden y se reparte en las páginas nuevas. */
export function setPerPage(a: Album, perPage: PerPage): Album {
  return { ...a, perPage }
}

export const sameSlot = (a: AlbumSlot | null, b: AlbumSlot | null): boolean => !!a && !!b && a.card === b.card && (a.print ?? '') === (b.print ?? '')

/**
 * Rellena el álbum con una lista de cartas. `replace` lo reemplaza entero; `append` las añade tras lo último
 * (sin repetir las que ya estén colocadas). Se detiene en MAX_SLOTS.
 */
export function fillAlbum(a: Album, entries: AlbumSlot[], mode: 'replace' | 'append'): Album {
  const placed = mode === 'replace' ? [] : a.slots.filter((s): s is AlbumSlot => s !== null)
  const fresh = entries.filter((e, i) => !placed.some((p) => sameSlot(p, e)) && entries.findIndex((x) => sameSlot(x, e)) === i)
  if (mode === 'replace') return { ...a, slots: fresh.slice(0, MAX_SLOTS) }
  // `append`: tras lo último que haya, sin tocar los huecos que el usuario dejó en medio
  const slots = [...a.slots]
  while (slots.length > 0 && slots[slots.length - 1] === null) slots.pop()
  return { ...a, slots: [...slots, ...fresh].slice(0, MAX_SLOTS) }
}

/** Cuántas cartas (bolsillos con carta) hay colocadas. */
export const filled = (a: Album): number => a.slots.reduce((n, s) => n + (s ? 1 : 0), 0)

/* ---------- guardado en el navegador ---------- */

const KEY_PREFIX = 'ncd.album.v1.'
export const albumKey = (userId: string | null | undefined): string => `${KEY_PREFIX}${userId || 'invitado'}`

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Valida lo leído del navegador: solo se queda con bolsillos bien formados cuya carta existe en el catálogo.
 * Una impresión que `valid` no acepte (ya no existe) se descarta, pero la carta se conserva.
 */
export function sanitizeAlbum(raw: unknown, valid: (s: AlbumSlot) => boolean, cardExists: (id: string) => boolean): Album {
  const base = emptyAlbum()
  if (!isRecord(raw)) return base
  const perPage = PAGE_SIZES.includes(raw.perPage as PerPage) ? (raw.perPage as PerPage) : base.perPage
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, MAX_NAME) : base.name
  const list = Array.isArray(raw.slots) ? raw.slots.slice(0, MAX_SLOTS) : []
  const slots = list.map((s): AlbumSlot | null => {
    if (!isRecord(s) || typeof s.card !== 'string' || !cardExists(s.card)) return null
    if (typeof s.print === 'string' && s.print.length <= 200) {
      const withPrint: AlbumSlot = { card: s.card, print: s.print }
      if (valid(withPrint)) return withPrint
    }
    return { card: s.card }
  })
  const stamp = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) && raw.updatedAt > 0 ? Math.floor(raw.updatedAt) : 0
  return stamp > 0 ? { name, perPage, slots, updatedAt: stamp } : { name, perPage, slots }
}

export function saveAlbum(key: string, a: Album, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): boolean {
  try {
    if (!storage) return false
    storage.setItem(key, JSON.stringify(a))
    return true
  } catch {
    return false
  }
}

export function loadAlbum(key: string, valid: (s: AlbumSlot) => boolean, cardExists: (id: string) => boolean, storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Album {
  try {
    const text = storage?.getItem(key)
    return text ? sanitizeAlbum(JSON.parse(text), valid, cardExists) : emptyAlbum()
  } catch {
    return emptyAlbum()
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

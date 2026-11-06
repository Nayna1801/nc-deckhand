/** Fichas por página en Cartas: 8 filas de 6 en escritorio, 24 de 2 en móvil. */
export const PAGE_SIZE = 48

export const pageCount = (total: number, size: number = PAGE_SIZE): number => Math.max(1, Math.ceil(Math.max(0, total) / size))

/** Deja la página dentro de lo que existe (la lista puede encoger al filtrar). */
export const clampPage = (page: number, total: number, size: number = PAGE_SIZE): number =>
  Math.min(Math.max(1, Math.floor(Number(page)) || 1), pageCount(total, size))

export function pageItems<T>(items: readonly T[], page: number, size: number = PAGE_SIZE): T[] {
  const p = clampPage(page, items.length, size)
  return items.slice((p - 1) * size, p * size)
}

/** Primer y último elemento (1-based) que muestra una página; 0–0 si no hay nada. */
export function pageRange(page: number, total: number, size: number = PAGE_SIZE): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 }
  const p = clampPage(page, total, size)
  return { from: (p - 1) * size + 1, to: Math.min(total, p * size) }
}

/** Números de página a mostrar con huecos: 1 … 4 5 6 … 12 (siempre la primera, la última y las vecinas de la actual). */
export function pageWindow(page: number, pages: number, around = 1): (number | '…')[] {
  const keep = new Set<number>([1, pages])
  for (let i = page - around; i <= page + around; i++) if (i >= 1 && i <= pages) keep.add(i)
  const sorted = [...keep].sort((a, b) => a - b)
  const out: (number | '…')[] = []
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push(n - sorted[i - 1] === 2 ? n - 1 : '…')
    out.push(n)
  })
  return out
}

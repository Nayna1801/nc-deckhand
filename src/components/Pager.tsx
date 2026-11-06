import { pageCount, pageRange, pageWindow } from '../lib/paging'

interface Props {
  page: number
  total: number
  size: number
  onChange: (page: number) => void
  /** Texto que cuenta los elementos ("cartas", "impresiones"). */
  unit: string
}

/** Navegación por páginas: anterior, números con huecos y siguiente. No se muestra si todo cabe en una página. */
export function Pager({ page, total, size, onChange, unit }: Props) {
  const pages = pageCount(total, size)
  if (pages <= 1) return null
  const { from, to } = pageRange(page, total, size)
  return (
    <nav className="pager" aria-label="Paginación">
      <button type="button" className="btn sm" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Página anterior">‹ Anterior</button>
      <ol className="pager-pages">
        {pageWindow(page, pages).map((n, i) =>
          n === '…' ? (
            <li key={`gap-${i}`} className="pager-gap" aria-hidden="true">…</li>
          ) : (
            <li key={n}>
              <button type="button" className={`btn sm ${n === page ? 'primary' : ''}`} aria-current={n === page ? 'page' : undefined} aria-label={`Página ${n}`} onClick={() => onChange(n)}>{n}</button>
            </li>
          ),
        )}
      </ol>
      <button type="button" className="btn sm" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Página siguiente">Siguiente ›</button>
      <span className="muted small pager-info">{from}–{to} de {total} {unit}</span>
    </nav>
  )
}

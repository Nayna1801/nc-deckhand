import type { CostBucket, TypeSlice } from '../lib/analytics'

const TYPE_COLOR: Record<TypeSlice['type'], string> = { Unit: 'var(--cyan)', Gear: 'var(--yellow)', Program: 'var(--magenta)' }
const TYPE_LABEL: Record<TypeSlice['type'], string> = { Unit: 'Units', Gear: 'Gear', Program: 'Programs' }

/** Histograma de la curva de coste en eddies. */
export function CostCurveChart({ buckets }: { buckets: CostBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count))
  const W = 300
  const H = 130
  const pad = { l: 6, r: 6, t: 18, b: 22 }
  const bw = (W - pad.l - pad.r) / buckets.length
  const total = buckets.reduce((a, b) => a + b.count, 0)
  const summary = buckets.map((b) => `coste ${b.label}: ${b.count}`).join(', ')
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Curva de coste. ${summary}`}>
        {buckets.map((b, i) => {
          const h = ((H - pad.t - pad.b) * b.count) / max
          const x = pad.l + i * bw
          const y = H - pad.b - h
          return (
            <g key={b.cost}>
              <rect x={x + 3} y={b.count ? y : H - pad.b - 1} width={bw - 6} height={b.count ? h : 1} fill={b.count ? 'var(--yellow)' : 'var(--line)'}>
                <title>{`Coste ${b.label}: ${b.count} carta(s)`}</title>
              </rect>
              {b.count > 0 && (
                <text x={x + bw / 2} y={y - 4} textAnchor="middle" className="chart-n">{b.count}</text>
              )}
              <text x={x + bw / 2} y={H - 7} textAnchor="middle" className="chart-l">{b.label}</text>
            </g>
          )
        })}
      </svg>
      <figcaption className="muted small">{total === 0 ? 'Añade cartas al mazo para ver la curva.' : `${total} cartas · coste medio ${(buckets.reduce((a, b) => a + b.cost * b.count, 0) / total).toFixed(1)}`}</figcaption>
    </figure>
  )
}

/** Gráfico circular del ratio Units / Gear / Programs. */
export function TypeDonut({ slices }: { slices: TypeSlice[] }) {
  const total = slices.reduce((a, s) => a + s.count, 0)
  const R = 40
  const C = 2 * Math.PI * R
  let offset = 0
  const summary = slices.map((s) => `${TYPE_LABEL[s.type]} ${s.percent}%`).join(', ')
  return (
    <figure className="chart donut">
      <svg viewBox="0 0 120 120" role="img" aria-label={`Ratio de tipos. ${summary}`}>
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--line)" strokeWidth="18" />
        {total > 0 &&
          slices.map((s) => {
            const len = (s.count / total) * C
            const el = (
              <circle
                key={s.type}
                cx="60" cy="60" r={R} fill="none" stroke={TYPE_COLOR[s.type]} strokeWidth="18"
                strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
                transform="rotate(-90 60 60)"
              >
                <title>{`${TYPE_LABEL[s.type]}: ${s.count} (${s.percent}%)`}</title>
              </circle>
            )
            offset += len
            return el
          })}
        <text x="60" y="64" textAnchor="middle" className="chart-total">{total}</text>
      </svg>
      <ul className="legend plain">
        {slices.map((s) => (
          <li key={s.type}>
            <span className="swatch" style={{ background: TYPE_COLOR[s.type] }} />
            {TYPE_LABEL[s.type]} <strong>{s.count}</strong> <span className="muted">({s.percent}%)</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

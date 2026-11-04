import { catalog } from '../lib/catalog'
import { colorCode, COLOR_INITIAL } from '../lib/colorCode'

/** Identidad de color del mazo: iniciales destacadas (GGR, BBG…) y nombres completos debajo. */
export function ColorCode({ legendIds, showNames = true }: { legendIds: string[]; showNames?: boolean }) {
  const cc = colorCode(legendIds, catalog)
  if (cc.colors.length === 0) return <span className="muted small">Sin colores (elige Legends)</span>
  return (
    <span className="colorcode" role="img" aria-label={`Colores del mazo: ${cc.label.replace(/ · /g, ', ')}`}>
      <span className="cc-letters" aria-hidden="true">
        {cc.colors.map((c, i) => (
          <span key={i} className={`cc cc-${c.toLowerCase()}`}>{COLOR_INITIAL[c]}</span>
        ))}
      </span>
      {showNames && <span className="cc-names" aria-hidden="true">{cc.label}</span>}
    </span>
  )
}

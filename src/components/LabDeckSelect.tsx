import type { DeckOption } from '../lib/play'

/** Desplegable de mazos del Laboratorio, agrupados por origen (mis mazos de la web, deckforge, meta). */
export function LabDeckSelect({ label, value, onChange, options, narrow = false }: {
  label: string
  value: string
  onChange: (key: string) => void
  options: DeckOption[]
  narrow?: boolean
}) {
  const groups = [...new Set(options.map((o) => o.group))]
  return (
    <label className={`lab-field${narrow ? ' narrow' : ''}`}>
      <span>{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={!options.length}>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {options.filter((o) => o.group === g).map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

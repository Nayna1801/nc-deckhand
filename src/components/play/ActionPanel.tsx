import { useEffect } from 'react'
import { groupOptions, type PlayAsk } from '../../lib/play'
import { globalOptions, optionsFor, payHint, payOption, type Ref } from '../../lib/playTable'

interface Props {
  ask: PlayAsk
  sel: Ref | null
  selName: string | null
  selRules: string | null
  busy: boolean
  pay: { chosen: number[]; loose: number }
  onChoose: (index: number) => void
}

const HINT =
  'Toca una carta tuya para ver sus acciones. También puedes arrastrarla: a la mesa para jugarla, a tus Eddies para venderla, o una Unidad a los Gigs o a una Unidad rival para atacar.'

/** Abajo a la derecha: las acciones de la carta tocada (o las opciones de la pregunta si no es el turno normal). */
export function ActionPanel({ ask, sel, selName, selRules, busy, pay, onChoose }: Props) {
  const visible: number[] = [] // posiciones que enseñan un botón, en orden: las cifras 1-9 las eligen
  const button = (index: number, label: string, primary = false) => {
    visible.push(index)
    const n = visible.length
    return (
      <button key={index} type="button" className={`btn pt-opt${primary ? ' primary' : ''}`} disabled={busy} onClick={() => onChoose(index)}>
        {n <= 9 && <kbd>{n}</kbd>}
        {label}
      </button>
    )
  }

  let body: React.ReactNode
  if (ask.kind === 'action') {
    const mine = optionsFor(ask.options, sel)
    const general = globalOptions(ask.options)
    const end = general.find((o) => o.option.group === 'fin')
    body = (
      <>
        {sel ? (
          <div className="pt-ap-block">
            <h4>{selName ?? 'Seleccionada'}</h4>
            {selRules && <p className="pt-rules">{selRules}</p>}
            {mine.length ? mine.map((o) => button(o.index, o.option.label)) : <p className="muted small">Sin acciones posibles ahora mismo con esta carta.</p>}
          </div>
        ) : (
          <p className="muted small pt-hint-box">{HINT}</p>
        )}
        {general.some((o) => o.option.group !== 'fin') && (
          <div className="pt-ap-block">
            <h4>Habilidades</h4>
            {general.filter((o) => o.option.group !== 'fin').map((o) => button(o.index, o.option.label))}
          </div>
        )}
        {end && <div className="pt-ap-end">{button(end.index, end.option.label, true)}</div>}
      </>
    )
  } else if (ask.kind === 'pay') {
    const need = ask.extra?.need ?? 0
    const chosen = pay.chosen
    const found = payOption(ask.options, chosen)
    body = (
      <>
        <p className="small">Toca las Legends que quieres gastar; el resto sale de tus Eddies sueltos ({pay.loose} disponibles).</p>
        <p className="pt-pay-hint" role="status">{payHint(ask.options, chosen, need, pay.loose)}</p>
        <div className="pt-ap-end">{found !== null ? button(found, 'Pagar así', true) : <button type="button" className="btn primary pt-opt" disabled>Pagar así</button>}</div>
        <div className="pt-ap-block">
          <h4>O elige una combinación</h4>
          {ask.options.map((o, i) => button(i, o.label))}
        </div>
      </>
    )
  } else {
    const groups = groupOptions(ask.options)
    const titles = groups.filter((g) => g.title).length > 1
    body = (
      <>
        {ask.kind === 'target' || ask.kind === 'react' ? <p className="muted small">También puedes tocar la carta en la mesa.</p> : null}
        {groups.map((g) => (
          <div className="pt-ap-block" key={g.group}>
            {titles && g.title && <h4>{g.title}</h4>}
            {g.items.map((it) => button(it.index, it.option.label))}
          </div>
        ))}
      </>
    )
  }

  // atajos de teclado: 1-9 eligen el botón de esa posición
  const key = visible.join(',')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (busy || e.ctrlKey || e.metaKey || e.altKey || (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= Math.min(9, visible.length)) onChoose(visible[n - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, busy, onChoose])

  return (
    <section className="pt-actions" aria-label="Acciones" aria-live="polite">
      <h3 className="pt-ap-title">{ask.prompt}</h3>
      {body}
      {busy && <p className="muted small pt-busy" role="status">El piloto está pensando…</p>}
    </section>
  )
}

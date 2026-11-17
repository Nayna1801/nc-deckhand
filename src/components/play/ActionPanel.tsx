import { useEffect } from 'react'
import { groupOptions, isActionLike, type PlayAsk } from '../../lib/play'
import { cardMenu, globalOptions, optionsFor, sameRef, type Ref } from '../../lib/playTable'

interface Props {
  ask: PlayAsk
  sel: Ref | null
  selName: string | null
  selRules: string | null
  busy: boolean
  paid: number // al pagar: cuántos € lleva marcados en la mesa (Eddies y Legends)
  sub: string | null // subacción abierta de la carta seleccionada (p. ej. «atacar a una Unidad»)
  onSub: (key: string | null) => void
  onChoose: (index: number) => void
}

const HINT =
  'Toca una carta tuya para ver sus acciones. También puedes arrastrarla: a la mesa para jugarla, a tus Eddies para venderla, o una Unidad a los Gigs o a una Unidad rival para atacar.'
const PICK_HINT = 'Arrastra la carta resaltada de tu mano sobre la Unidad o la Legend boca arriba a la que la equipas (o tócala para ver la acción).'

/** Abajo a la derecha: las acciones de la carta tocada (o las opciones de la pregunta si no es el turno normal). */
export function ActionPanel({ ask, sel, selName, selRules, busy, paid, sub, onSub, onChoose }: Props) {
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
  if (isActionLike(ask.kind)) {
    const mine = optionsFor(ask.options, sel)
    const general = globalOptions(ask.options)
    const end = general.find((o) => o.option.group === 'fin')
    body = (
      <>
        {sel ? (
          <div className="pt-ap-block">
            <h4>{selName ?? 'Seleccionada'}</h4>
            {selRules && <p className="pt-rules">{selRules}</p>}
            {mine.length === 0 && <p className="muted small">Sin acciones posibles ahora mismo con esta carta.</p>}
            {cardMenu(mine).map((m) =>
              m.kind === 'direct' ? button(m.index, m.label) : (
                <div className="pt-sub" key={m.key}>
                  <button type="button" className={`btn pt-sub-toggle${sub === m.key ? ' open' : ''}`} aria-expanded={sub === m.key} disabled={busy} onClick={() => onSub(sub === m.key ? null : m.key)}>
                    {m.title}… <span>{m.items.length}</span>
                  </button>
                  {sub === m.key && (
                    <div className="pt-sub-list">
                      {m.key === 'atacar-unidad' && <p className="muted small">Elige la Unidad rival aquí o tócala en la mesa.</p>}
                      {m.items.map((it) => button(it.index, it.label))}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        ) : (
          <p className="muted small pt-hint-box">{ask.kind === 'pick' ? PICK_HINT : HINT}</p>
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
    body = (
      <>
        <p className="small">Toca en la mesa los Eddies y las Legends que quieres gastar. Al marcar el último, se paga.</p>
        <p className="pt-pay-hint" role="status">{paid} de {need} € marcados</p>
        <div className="pt-ap-block" title={ask.options[0]?.label}>{button(0, 'Que se pague solo (Eddies sueltos primero)')}</div>
      </>
    )
  } else {
    const groups = groupOptions(ask.options)
    const titles = groups.filter((g) => g.title).length > 1
    const ofSel = sel ? ask.options.map((option, index) => ({ option, index })).filter((o) => sameRef(o.option.ref, sel)) : []
    body = (
      <>
        {ask.kind === 'target' ? <p className="muted small">También puedes tocar la carta en la mesa.</p> : null}
        {ask.kind === 'react' ? <p className="muted small">Toca una carta resaltada para ver lo que puede hacer; no hace nada hasta que pulses su botón.</p> : null}
        {ofSel.length > 0 && (
          <div className="pt-ap-block pt-ap-sel">
            <h4>{selName ?? 'Seleccionada'}</h4>
            {ofSel.map((o) => button(o.index, o.option.label, true))}
          </div>
        )}
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

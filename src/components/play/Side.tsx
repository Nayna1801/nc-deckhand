import type { DragEvent } from 'react'
import { catalog } from '../../lib/catalog'
import { dieOwner, eddiesOf, isNewCopy, streetCred, type ReplayPlayer } from '../../lib/replay'
import { refKey, sameRef, type Drop, type Ref } from '../../lib/playTable'
import { Die } from '../ReplayBoard'
import { TCard } from './TCard'
import type { TableUI } from './types'

interface Props {
  index: 0 | 1
  p: ReplayPlayer
  name: string
  active: boolean
  prev: Map<string, number> | null
  ui: TableUI
}

/** Una mitad de la mesa: mano, Legends, Eddies, Gigs, fixer y Unidades. Tú abajo (con tu mano visible) y el rival arriba. */
export function Side({ index, p, name, active, prev, ui }: Props) {
  const mine = index === ui.mySeat
  const ed = eddiesOf(p)
  const seen = new Map<string, number>()
  const nth = (zone: string, id: string): boolean => {
    const k = `${index}|${zone}|${id}`
    const n = (seen.get(k) ?? 0) + 1
    seen.set(k, n)
    return isNewCopy(prev, k, n)
  }
  // siempre enganchados: el navegador decide si acepta la suelta en cuanto el ratón entra, antes de que React repinte
  const dropProps = (d: Drop) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (ui.isDropOk(d)) e.preventDefault()
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!ui.isDropOk(d)) return
      e.preventDefault()
      ui.onDrop(d)
    },
  })
  const dropOk = (d: Drop) => !!ui.drag && ui.isDropOk(d)
  const drag = (ref: Ref, can: boolean) => ({
    draggable: mine && can && !ui.busy,
    onDragStart: () => ui.setDrag(ref),
    onDragEnd: () => ui.setDrag(null),
  })
  /** Toca: elige entre candidatos si toca elegir, o selecciona la carta propia para ver sus acciones. */
  const tap = (ref: Ref) => () => {
    if (ui.busy) return
    if (ui.cand.has(refKey(ref))) ui.onPickCandidate(ref)
    else if (mine) ui.onSelect(sameRef(ui.sel, ref) ? null : ref)
  }
  const flags = (ref: Ref) => ({ can: ui.can.has(refKey(ref)), cand: ui.cand.has(refKey(ref)), selected: sameRef(ui.sel, ref) })
  const lastSpent = p.e[0] - p.e[1]

  return (
    <section className={`pt-side ${mine ? 'mine' : 'rival'}${active ? ' active' : ''}`} aria-label={mine ? 'Tu lado' : 'Lado del piloto'}>
      <div className="pt-tag">
        <span className="pt-who">{mine ? 'Tú' : 'Piloto'} · J{index + 1}</span>
        <span className="pt-deck" title={name}>{name}</span>
        <span className="pt-counts">Mazo {p.d} · Basura {p.t}</span>
        {active && <span className="pt-now">● su turno</span>}
      </div>

      <div className="pt-hand" aria-label={`Mano: ${p.h.length} cartas`}>
        {p.h.length === 0 && <span className="muted small">Mano vacía</span>}
        {p.h.map((id, k) => {
          if (id === null) return <TCard key={`b${k}`} id={null} />
          const ref: Ref = { z: 'h', side: index, id }
          return <TCard key={`${id}${k}`} id={id} isNew={nth('h', id)} {...flags(ref)} {...drag(ref, ui.can.has(refKey(ref)))} onClick={tap(ref)} onHover={ui.onHover} />
        })}
      </div>

      <div className="pt-zones">
        <div className="pt-zone" aria-label="Zona de Legends">
          <h4>
            Legends <span>{ed.legends}×1 €</span>
            {mine && ui.call.map((c) => (
              <button key={c.index} type="button" className="btn pt-call" disabled={ui.busy} title={c.label} onClick={() => ui.onChoose(c.index)}>
                {c.label.includes('al azar') ? 'Call (1 €)' : c.label.replace(/^Call \(1 €\): girar /, 'Call · ').replace(/ \(.*\)$/, '')}
              </button>
            ))}
          </h4>
          <div className="pt-row">
            {ed.legends === 0 && <span className="muted small">ninguna: bajaron al campo</span>}
            {p.l.map((l, k) => {
              const [id, up, ready, gone] = l
              if (gone) return null
              const ref: Ref = { z: 'l', side: index, i: k }
              const paying = mine && ui.pay.active && !!ready
              if (paying) {
                return (
                  <TCard key={k} id={up ? id : null} spent={false} cand paid={ui.pay.chosen.includes(k)} title={ui.pay.chosen.includes(k) ? 'Se gasta para pagar (toca para quitarla)' : 'Toca para gastarla al pagar'}
                    onClick={() => ui.onTogglePay(k)} onHover={ui.onHover} />
                )
              }
              if (up && id) return <TCard key={k} id={id} spent={!ready} {...flags(ref)} {...drag(ref, ui.can.has(refKey(ref)))} onClick={tap(ref)} onHover={ui.onHover} />
              return <TCard key={k} id={null} spent={!ready} title="Legend boca abajo: se gira con el Call, a ciegas" />
            })}
          </div>
        </div>

        <div className={`pt-zone${mine && dropOk({ z: 'eddies' }) ? ' drop-ok' : ''}`} aria-label="Zona de Eddies" {...(mine ? dropProps({ z: 'eddies' }) : {})}>
          <h4>Eddies <span>{ed.ready}/{ed.total}</span></h4>
          <div className="pt-row pt-eddies" title="Cada carta vendida queda boca abajo y da 1 Eddie; al gastarla se gira">
            {p.e[0] === 0 && <span className="muted small">{mine ? 'Arrastra aquí una carta para venderla' : 'ninguna carta vendida'}</span>}
            {Array.from({ length: p.e[0] }, (_, k) => (
              <div key={k} className={`pt-eddy${k >= p.e[0] - lastSpent ? ' spent' : ''}`} title={k >= p.e[0] - lastSpent ? 'Eddie gastado' : 'Eddie disponible'} />
            ))}
          </div>
          <span className="pt-hint">{ed.loose} vendidas + {ed.legends} Legends</span>
        </div>

        <div className={`pt-zone${dropOk({ z: 'gigs', side: index }) ? ' drop-ok' : ''}`} aria-label="Zona de Gigs" {...dropProps({ z: 'gigs', side: index })}>
          <h4>Gigs <span>{p.g.length}/7</span></h4>
          <div className="pt-row pt-dice">
            {p.g.length === 0 ? <span className="muted small">sin Gigs</span> : p.g.map((g, k) => <Die key={k} max={g[0]} value={g[1]} owner={dieOwner(g, index)} holder={index} />)}
          </div>
          <span className="pt-cred" title="Street Cred = suma de los valores de tus Gigs">Street Cred: <b>{streetCred(p)}</b></span>
        </div>

        <div className="pt-zone" aria-label="Fixer">
          <h4>Fixer <span>sin tirar</span></h4>
          <div className="pt-row pt-dice">
            {p.x.length === 0 ? <span className="muted small">vacío</span> : p.x.map((m, k) => <Die key={k} max={m} value={null} owner={index} holder={index} />)}
          </div>
        </div>
      </div>

      <div className={`pt-field${mine && dropOk({ z: 'field' }) ? ' drop-ok' : ''}`} aria-label={`Unidades de J${index + 1}`} {...(mine ? dropProps({ z: 'field' }) : {})}>
        {p.f.length === 0 && <span className="muted small">{mine ? 'Arrastra aquí una carta para jugarla' : 'Sin Unidades en mesa'}</span>}
        {p.f.map((u, k) => {
          const [id, power, ready, lag, gear, solo] = u
          const ref: Ref = { z: 'f', side: index, i: k }
          const unitDrop: Drop = { z: 'unit', side: index, i: k }
          return (
            <div className="pt-unit" key={`${id}${k}`}>
              <TCard id={id} power={power} spent={!ready} lag={!!lag && !!ready} solo={!!solo} isNew={nth('f', id)} dropOk={dropOk(unitDrop)} {...flags(ref)} {...drag(ref, ui.can.has(refKey(ref)))}
                onClick={tap(ref)} onHover={ui.onHover} {...dropProps(unitDrop)} />
              {gear.length > 0 && (
                <div className="pt-gear" title={gear.map((x) => catalog.byId[x]?.displayName ?? x).join(', ')}>{gear.map((x) => (catalog.byId[x]?.displayName ?? x).split(':')[0]).join(' · ')}</div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

import type { CSSProperties, DragEvent, ReactNode } from 'react'
import { catalog } from '../../lib/catalog'
import { dieOwner, eddiesOf, isNewCopy, streetCred, type ReplayPlayer } from '../../lib/replay'
import { refKey, sameRef, type Drop, type Ref } from '../../lib/playTable'
import { Die } from '../ReplayBoard'
import { TCard, type HoverFn } from './TCard'
import type { TableUI } from './types'

interface Props {
  index: 0 | 1
  p: ReplayPlayer
  name: string
  active: boolean
  prev: Map<string, number> | null
  ui: TableUI
}

const cardName = (id: string) => catalog.byId[id]?.displayName ?? id

/** Una Unidad o Legend con su Gear debajo: cada Gear asoma por abajo y se ve en grande al pasar el ratón. */
function Geared({ gear, onHover, children }: { gear: string[]; onHover: HoverFn; children: ReactNode }) {
  return (
    <div className="pt-unit" style={{ '--gear': gear.length } as CSSProperties}>
      {children}
      {gear.map((id, k) => (
        <div className="pt-gearcard" key={`${id}${k}`} style={{ '--k': k + 1 } as CSSProperties}>
          <TCard id={id} title={`Gear equipado: ${cardName(id)}`} onHover={onHover} />
        </div>
      ))}
    </div>
  )
}

/**
 * Una mitad de la mesa. Tu lado (abajo): arriba el fixer en vertical, el campo y, a la derecha, los Gigs sobre el mazo y la basura;
 * debajo la mano, las Legends y los Eddies. El lado del rival es el mismo, invertido (CSS), para que los dos campos queden enfrentados.
 */
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
      e.stopPropagation()
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
    if (ui.cand.has(refKey(ref)) && ui.pickOnTap) ui.onPickCandidate(ref)
    else if (mine) ui.onSelect(sameRef(ui.sel, ref) ? null : ref)
  }
  const flags = (ref: Ref) => ({ can: ui.can.has(refKey(ref)), cand: ui.cand.has(refKey(ref)), selected: sameRef(ui.sel, ref) })
  const paying = mine && ui.pay.active
  const trash = p.tr ?? []
  const top = trash[trash.length - 1]
  const who = mine ? 'tu' : 'la'

  const fixer = (
    <div className="pt-zone pt-fixer" aria-label="Fixer">
      <h4>Fixer</h4>
      <div className="pt-dice">
        {p.x.length === 0 ? <span className="muted small">vacío</span> : p.x.map((m, k) => <Die key={k} max={m} value={null} owner={index} holder={index} />)}
      </div>
    </div>
  )

  const field = (
    <div className={`pt-field${mine && dropOk({ z: 'field' }) ? ' drop-ok' : ''}`} aria-label={`Unidades de J${index + 1}`} {...(mine ? dropProps({ z: 'field' }) : {})}>
      {p.f.length === 0 && <span className="muted small">{mine ? 'Arrastra aquí una carta para jugarla' : 'Sin Unidades en mesa'}</span>}
      {p.f.map((u, k) => {
        const [id, power, ready, lag, gear, solo] = u
        const ref: Ref = { z: 'f', side: index, i: k }
        const unitDrop: Drop = { z: 'unit', side: index, i: k }
        return (
          <Geared key={`${id}${k}`} gear={gear} onHover={ui.onHover}>
            <TCard id={id} power={power} spent={!ready} lag={!!lag && !!ready} solo={!!solo} isNew={nth('f', id)} dropOk={dropOk(unitDrop)} {...flags(ref)} {...drag(ref, ui.can.has(refKey(ref)))}
              onClick={tap(ref)} onHover={ui.onHover} {...dropProps(unitDrop)} />
          </Geared>
        )
      })}
    </div>
  )

  const gigs = (
    <div className={`pt-zone pt-gigs${dropOk({ z: 'gigs', side: index }) ? ' drop-ok' : ''}`} aria-label="Zona de Gigs" {...dropProps({ z: 'gigs', side: index })}>
      <h4>Gigs <span>{p.g.length}/7</span> <span className="pt-cred" title="Street Cred = suma de los valores de tus Gigs">Street Cred <b>{streetCred(p)}</b></span></h4>
      <div className="pt-row pt-dice">
        {p.g.length === 0 ? <span className="muted small">sin Gigs</span> : p.g.map((g, k) => <Die key={k} max={g[0]} value={g[1]} owner={dieOwner(g, index)} holder={index} />)}
      </div>
    </div>
  )

  const piles = (
    <div className="pt-zone pt-piles" aria-label="Mazo y basura">
      <div className="pt-pile" title={`Quedan ${p.d} cartas en ${who} mazo`}>
        <div className={`pt-card back pt-deckcard${p.d === 0 ? ' empty' : ''}`} aria-label={`Mazo: ${p.d} cartas`}>
          <b className="pt-count">{p.d}</b>
        </div>
        <span>Mazo</span>
      </div>
      <div className="pt-pile">
        {top ? (
          <TCard id={top} title={`Basura: ${p.t} cartas. Arriba, ${cardName(top)}. Toca para verlas todas`} onClick={() => ui.onTrash(index)} onHover={ui.onHover}>
            <b className="pt-count">{p.t}</b>
          </TCard>
        ) : (
          <div className="pt-card pt-deckcard empty" aria-label="Basura: vacía">
            <b className="pt-count">{p.t}</b>
          </div>
        )}
        <span>Basura</span>
      </div>
    </div>
  )

  const hand = (
    <div className="pt-hand" aria-label={`Mano: ${p.h.length} cartas`}>
      {p.h.length === 0 && <span className="muted small">Mano vacía</span>}
      {p.h.map((id, k) => {
        if (id === null) return <TCard key={`b${k}`} id={null} />
        const ref: Ref = { z: 'h', side: index, id }
        return <TCard key={`${id}${k}`} id={id} isNew={nth('h', id)} {...flags(ref)} {...drag(ref, ui.can.has(refKey(ref)))} onClick={tap(ref)} onHover={ui.onHover} />
      })}
    </div>
  )

  const legends = (
    <div className="pt-zone pt-legs" aria-label="Zona de Legends">
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
          const [id, up, ready, gone, gear] = l
          if (gone) return null
          const ref: Ref = { z: 'l', side: index, i: k }
          const legDrop: Drop = { z: 'legend', side: index, i: k }
          let card: ReactNode
          if (paying && ui.pay.legs.has(k)) {
            const marked = ui.pay.marks.legs.includes(k)
            card = <TCard id={up ? id : null} spent={false} cand paid={marked} title={marked ? 'Se gasta para pagar (toca para quitarla)' : 'Toca para gastarla al pagar'}
              onClick={() => ui.onTogglePay('l', k)} onHover={ui.onHover} />
          } else if (up && id) {
            card = <TCard id={id} spent={!ready} dropOk={mine && dropOk(legDrop)} {...flags(ref)} {...drag(ref, ui.can.has(refKey(ref)))} onClick={tap(ref)} onHover={ui.onHover}
              {...(mine ? dropProps(legDrop) : {})} />
          } else {
            card = <TCard id={null} spent={!ready} title="Legend boca abajo: se gira con el Call, a ciegas" />
          }
          return <Geared key={k} gear={gear} onHover={ui.onHover}>{card}</Geared>
        })}
      </div>
    </div>
  )

  const eddies = (
    <div className={`pt-zone pt-eddyzone${mine && dropOk({ z: 'eddies' }) ? ' drop-ok' : ''}`} aria-label="Zona de Eddies" {...(mine ? dropProps({ z: 'eddies' }) : {})}>
      <h4>Eddies <span>{ed.ready}/{ed.total}</span> <span className="pt-hint">{ed.loose} vendidas + {ed.legends} Legends</span></h4>
      <div className="pt-row pt-eddies" title={paying ? undefined : 'Cada carta vendida queda boca abajo y da 1 Eddie; al gastarla se gira'}>
        {p.e[0] === 0 && <span className="muted small">{mine ? 'Arrastra aquí una carta para venderla' : 'ninguna carta vendida'}</span>}
        {Array.from({ length: p.e[0] }, (_, k) => {
          const spent = k >= p.e[1]
          if (paying && !spent) {
            const marked = ui.pay.marks.eddies.includes(k)
            return <button key={k} type="button" className={`pt-eddy cand${marked ? ' paid' : ''}`} aria-pressed={marked} aria-label={`Eddie ${k + 1}`}
              title={marked ? 'Se gasta para pagar (toca para quitarlo)' : 'Toca para gastarlo al pagar'} disabled={ui.busy} onClick={() => ui.onTogglePay('e', k)} />
          }
          return <div key={k} className={`pt-eddy${spent ? ' spent' : ''}`} title={spent ? 'Eddie gastado' : 'Eddie disponible'} />
        })}
      </div>
    </div>
  )

  return (
    <section className={`pt-side ${mine ? 'mine' : 'rival'}${active ? ' active' : ''}`} aria-label={mine ? 'Tu lado' : 'Lado del piloto'}>
      <div className="pt-tag">
        <span className="pt-who">{mine ? 'Tú' : 'Piloto'} · J{index + 1}</span>
        <span className="pt-deck" title={name}>{name}</span>
        {active && <span className="pt-now">● su turno</span>}
      </div>
      <div className="pt-top">
        {fixer}
        {field}
        <div className="pt-right">
          {gigs}
          {piles}
        </div>
      </div>
      <div className="pt-bottom">
        {hand}
        {legends}
        {eddies}
      </div>
    </section>
  )
}

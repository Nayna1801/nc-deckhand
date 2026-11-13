import { useEffect, useMemo, useRef, useState } from 'react'
import { catalog } from '../lib/catalog'
import type { PlayAsk } from '../lib/play'
import { actorKeys, candidateKeys, canDrop, dropOption, optionForRef, zoneOptions, type Drop, type Ref } from '../lib/playTable'
import { lineKinds, stepLabel, zoneCounts, type ReplayState } from '../lib/replay'
import { currentPlayer } from '../lib/play'
import { ActionPanel } from './play/ActionPanel'
import { CardZoom, useHoverZoom } from './play/CardZoom'
import { Side } from './play/Side'
import type { TableUI } from './play/types'
import '../playtable.css'

interface Props {
  ask: PlayAsk
  names: [string, string] // [mi mazo, mazo rival]
  myLegends: string[] // las tres Legends de tu mazo: las conoces aunque estén boca abajo
  lines: string[]
  busy: boolean
  onChoose: (index: number) => void
  onAbort: () => void
}

/**
 * Mesa de juego en vivo. Tú abajo, el piloto arriba. Toca una carta tuya para ver sus acciones (abajo a la derecha) o arrástrala:
 * a la mesa para jugarla, a tus Eddies para venderla; una Unidad a los Gigs rivales o a una Unidad rival para atacar. Pasa el ratón
 * por una carta para verla en grande.
 */
export function PlayBoard({ ask, names, myLegends, lines, busy, onChoose, onAbort }: Props) {
  const me = ask.me
  const rival = (1 - me) as 0 | 1
  const [sel, setSel] = useState<Ref | null>(null)
  const [drag, setDragState] = useState<Ref | null>(null)
  const dragRef = useRef<Ref | null>(null) // lo que se arrastra, al instante (el estado llega tarde para decidir si se acepta una suelta)
  const [payChosen, setPayChosen] = useState<number[]>([])
  const pending = useRef<Ref | null>(null) // a qué Unidad se soltó un Gear: contesta solo a «¿a qué se equipa?»
  const prevView = useRef<ReplayState | null>(null)
  const logRef = useRef<HTMLOListElement>(null)
  const { zoom, onHover } = useHoverZoom()
  const setDrag = (d: Ref | null) => {
    dragRef.current = d
    setDragState(d)
  }
  const prev = prevView.current ? zoneCounts(prevView.current) : null
  const active = currentPlayer(lines)

  const can = useMemo(() => (ask.kind === 'action' ? actorKeys(ask.options) : new Set<string>()), [ask])
  const cand = useMemo(() => candidateKeys(ask.options), [ask])
  const call = useMemo(() => (ask.kind === 'action' ? zoneOptions(ask.options, 'lz').map((o) => ({ label: o.option.label, index: o.index })) : []), [ask])

  // cada pregunta nueva empieza sin selección; y si se soltó un Gear sobre una Unidad, se contesta a «¿a qué se equipa?»
  useEffect(() => {
    setSel(null)
    setDrag(null)
    setPayChosen([])
    prevView.current = ask.view
    const want = pending.current
    pending.current = null
    if (want && ask.kind === 'target') {
      const hit = optionForRef(ask.options, want)
      if (hit) onChoose(hit.index)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask])

  useEffect(() => {
    const box = logRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [lines.length])

  const ui: TableUI = {
    mySeat: me,
    options: ask.options,
    sel,
    can,
    cand,
    pay: { active: ask.kind === 'pay', chosen: payChosen },
    drag,
    call,
    busy,
    onSelect: setSel,
    onPickCandidate: (ref) => {
      const hit = optionForRef(ask.options, ref)
      if (hit) onChoose(hit.index)
    },
    onTogglePay: (i) => setPayChosen((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i])),
    onChoose,
    setDrag,
    isDropOk: (d: Drop) => !!dragRef.current && ask.kind === 'action' && canDrop(ask.options, dragRef.current, d),
    onDrop: (d: Drop) => {
      const dragged = dragRef.current
      setDrag(null)
      const hit = dragged ? dropOption(ask.options, dragged, d) : null
      if (!hit || !dragged) return
      if (dragged.z === 'h' && d.z === 'unit') pending.current = { z: 'f', side: d.side, i: d.i }
      onChoose(hit.index)
    },
    onHover,
  }

  const mine = ask.view.p[me]
  const selId = sel ? (sel.z === 'h' ? sel.id : sel.z === 'f' ? mine.f[sel.i ?? -1]?.[0] : mine.l[sel.i ?? -1]?.[0]) : undefined
  const selCard = selId ? catalog.byId[selId] : undefined
  const legendNames = myLegends.map((id) => catalog.byId[id]?.displayName.split(':')[0] ?? id).join(' · ')

  return (
    <div className="pt">
      <div className="pt-bar">
        <b>Partida en vivo</b>
        <span className="muted small">Juegas como J{me + 1}{me === 0 ? ' (empiezas)' : ' (empieza el piloto)'} · Turno {ask.turn}</span>
        <span className="muted small pt-legends">Tus Legends (a ciegas): {legendNames}</span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onAbort} disabled={busy}>Abandonar</button>
      </div>

      <div className="pt-grid">
        <div className="pt-table" onDragEnd={() => setDrag(null)}>
          <Side index={rival} p={ask.view.p[rival]} name={`${names[1]} (piloto)`} active={active === rival + 1} prev={prev} ui={ui} />
          <Side index={me} p={mine} name={names[0]} active={active === me + 1} prev={prev} ui={ui} />
        </div>

        <aside className="pt-aside">
          <div className="pt-console">
            <h2>Consola de acciones</h2>
            <ol className="pt-log" ref={logRef}>
              {lines.map((text, k) => (
                <li key={k}>
                  <div className={['rp-line', ...lineKinds(text), k === lines.length - 1 && 'cur'].filter(Boolean).join(' ')}>{stepLabel(text)}</div>
                </li>
              ))}
            </ol>
          </div>
          <ActionPanel ask={ask} sel={sel} selName={selCard?.displayName ?? null} selRules={selCard?.rules ?? null} busy={busy} pay={{ chosen: payChosen, loose: mine.e[1] }} onChoose={onChoose} />
        </aside>
      </div>

      <CardZoom zoom={zoom} />
    </div>
  )
}


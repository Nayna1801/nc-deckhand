import { useEffect, useMemo, useRef, useState } from 'react'
import { catalog } from '../lib/catalog'
import type { PlayAsk } from '../lib/play'
import { actorKeys, candidateKeys, canDrop, dropOption, optionForRef, optionsFor, refKey, sameRef, payLimits, payPick, togglePay, zoneOptions, type Drop, type PayMarks, type Ref } from '../lib/playTable'
import { lineKinds, stepLabel, zoneCounts, type ReplayState } from '../lib/replay'
import { currentPlayer, isActionLike, picksOnTap } from '../lib/play'
import { ActionPanel } from './play/ActionPanel'
import { CardZoom, useHoverZoom } from './play/CardZoom'
import { Side } from './play/Side'
import { TrashList } from './play/TrashList'
import type { TableUI } from './play/types'
import '../playtable.css'

interface Props {
  ask: PlayAsk
  names: [string, string] // [mi mazo, mazo rival]
  warnings: string[] // mazos que no cumplen las reglas de construcción
  myLegends: string[] // las tres Legends de tu mazo: las conoces aunque estén boca abajo
  lines: string[]
  busy: boolean
  onChoose: (index: number) => void
  onAbort: () => void
}

/**
 * Mesa de juego en vivo. Tú abajo, el piloto arriba. Toca una carta tuya para ver sus acciones (abajo a la derecha) o arrástrala:
 * a la mesa para jugarla, a tus Eddies para venderla; un Gear sobre la Unidad o la Legend boca arriba a la que se equipa; una Unidad a
 * los Gigs rivales o a una Unidad rival para atacar. Al pagar, tocas los Eddies y las Legends que gastas: con el último se paga. Pasa el
 * ratón por una carta para verla en grande; toca una basura para ver sus cartas.
 */
const NO_MARKS: PayMarks = { legs: [], eddies: [] }

export function PlayBoard({ ask, warnings, names, myLegends, lines, busy, onChoose, onAbort }: Props) {
  const me = ask.me
  const rival = (1 - me) as 0 | 1
  const [sel, setSel] = useState<Ref | null>(null)
  const [drag, setDragState] = useState<Ref | null>(null)
  const dragRef = useRef<Ref | null>(null) // lo que se arrastra, al instante (el estado llega tarde para decidir si se acepta una suelta)
  const [marks, setMarks] = useState<PayMarks>(NO_MARKS)
  const [trash, setTrash] = useState<0 | 1 | null>(null) // de quién es la basura que se está mirando
  const [sub, setSub] = useState<string | null>(null) // subacción abierta de la carta seleccionada
  const pending = useRef<Ref | null>(null) // a qué Unidad o Legend se soltó un Gear: contesta solo a «¿a qué se equipa?»
  const prevView = useRef<ReplayState | null>(null)
  const logRef = useRef<HTMLOListElement>(null)
  const { zoom, onHover } = useHoverZoom()
  const setDrag = (d: Ref | null) => {
    dragRef.current = d
    setDragState(d)
  }
  const prev = prevView.current ? zoneCounts(prevView.current) : null
  const active = currentPlayer(lines)

  const can = useMemo(() => (isActionLike(ask.kind) ? actorKeys(ask.options) : new Set<string>()), [ask])
  // con «atacar a una Unidad» abierto, las Unidades rivales a las que puede atacar la seleccionada se eligen tocándolas en la mesa
  const attackTargets = useMemo(
    () => (sub === 'atacar-unidad' && isActionLike(ask.kind) ? optionsFor(ask.options, sel).filter((o) => o.option.group === 'atacar' && o.option.to?.z === 'f') : []),
    [ask, sel, sub],
  )
  const cand = useMemo(() => new Set([...candidateKeys(ask.options), ...attackTargets.map((o) => refKey(o.option.to!))]), [ask, attackTargets])
  const call = useMemo(() => (ask.kind === 'action' ? zoneOptions(ask.options, 'lz').map((o) => ({ label: o.option.label, index: o.index })) : []), [ask])
  const limits = useMemo(() => payLimits(ask.kind === 'pay' ? ask.options : []), [ask])
  const need = ask.extra?.need ?? 0

  // cada pregunta nueva empieza sin selección; y si se soltó un Gear sobre una Unidad, se contesta a «¿a qué se equipa?»
  useEffect(() => {
    setSel(null)
    setSub(null)
    setDrag(null)
    setMarks(NO_MARKS)
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
    pickOnTap: picksOnTap(ask.kind),
    pay: { active: ask.kind === 'pay', marks, legs: limits.legs, eddies: limits.eddies },
    drag,
    call,
    busy,
    onSelect: (r) => {
      setSel(r)
      setSub(null)
    },
    onPickCandidate: (ref) => {
      const hit = attackTargets.find((o) => sameRef(o.option.to, ref)) ?? optionForRef(ask.options, ref)
      if (hit) onChoose(hit.index)
    },
    onTogglePay: (kind, i) => {
      const next = togglePay(ask.options, marks, kind, i, need)
      setMarks(next)
      const hit = payPick(ask.options, next, need) // con el último Eddie o Legend marcado, se paga
      if (hit !== null) onChoose(hit)
    },
    onChoose,
    onTrash: setTrash,
    setDrag,
    isDropOk: (d: Drop) => {
      const dragged = dragRef.current
      if (!dragged || !isActionLike(ask.kind)) return false
      if (d.z === 'legend' && catalog.byId[dragged.id ?? '']?.type !== 'Gear') return false // sobre una Legend solo se suelta Gear
      return canDrop(ask.options, dragged, d)
    },
    onDrop: (d: Drop) => {
      const dragged = dragRef.current
      setDrag(null)
      const hit = dragged ? dropOption(ask.options, dragged, d) : null
      if (!hit || !dragged) return
      if (dragged.z === 'h' && d.z === 'unit') pending.current = { z: 'f', side: d.side, i: d.i }
      if (dragged.z === 'h' && d.z === 'legend') pending.current = { z: 'l', side: d.side, i: d.i }
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
        {warnings.length > 0 && <span className="pt-warn small" role="note" title={warnings.join('\n')}>⚠ Mazo no legal</span>}
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
          <ActionPanel ask={ask} sel={sel} selName={selCard?.displayName ?? null} selRules={selCard?.rules ?? null} busy={busy} paid={marks.legs.length + marks.eddies.length} sub={sub} onSub={setSub} onChoose={onChoose} />
        </aside>
      </div>

      {trash !== null && (
        <TrashList title={trash === me ? 'Tu basura' : 'Basura del piloto'} cards={ask.view.p[trash].tr ?? []} onClose={() => setTrash(null)} onHover={onHover} />
      )}
      <CardZoom zoom={zoom} />
    </div>
  )
}


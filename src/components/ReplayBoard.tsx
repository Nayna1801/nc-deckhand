import { useEffect, useMemo, useRef, useState } from 'react'
import { catalog } from '../lib/catalog'
import { thumbOf } from '../lib/images'
import {
  dieOwner,
  eddiesOf,
  isEnd,
  isNewCopy,
  lineKinds,
  stepLabel,
  streetCred,
  whoOf,
  zoneCounts,
  type ReplayCardInfo,
  type ReplayGame,
  type ReplayPlayer,
} from '../lib/replay'

const SHAPES: Record<number, string> = {
  4: '20,4 37,34 3,34',
  6: '7,7 33,7 33,33 7,33',
  8: '20,3 36,20 20,37 4,20',
  10: '20,2 35,15 29,37 11,37 5,15',
  12: '20,3 36,14 30,35 10,35 4,14',
  20: '20,3 35,12 35,28 20,37 5,28 5,12',
}
const SPEEDS = [0.5, 1, 2, 4]
const STEP_MS = 900

export function Die({ max, value, owner, holder }: { max: number; value: number | null; owner: number; holder: number }) {
  const idle = value === null
  const stolen = !idle && owner !== holder
  const label = `d${max} de J${owner + 1}`
  const title = idle ? `${label} (sin tirar)` : `${label} = ${value}${stolen ? ` · robado: lo tiene J${holder + 1}` : ''}`
  return (
    <span className={`rp-die o${owner + 1}${idle ? ' idle' : ''}${stolen ? ' stolen' : ''}`} title={title} aria-label={title}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <polygon points={SHAPES[max] ?? SHAPES[6]} />
      </svg>
      <b>{idle ? `D${max}` : value}</b>
      {!idle && <i>d{max}</i>}
    </span>
  )
}

interface FaceProps {
  id: string
  power?: number
  spent?: boolean
  lag?: boolean
  solo?: boolean
  gone?: boolean
  isNew?: boolean
  onPick: (id: string) => void
}

export function CardFace({ id, power, spent, lag, solo, gone, isNew, onPick }: FaceProps) {
  const card = catalog.byId[id]
  const [broken, setBroken] = useState(false)
  const name = card?.displayName ?? id
  const cls = ['rp-card', spent && 'spent', lag && 'lag', solo && 'solo', gone && 'gone', isNew && 'new', (broken || !card) && 'noimg'].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} title={name} aria-label={name} onClick={() => onPick(id)}>
      {card && !broken && <img src={`${import.meta.env.BASE_URL}${thumbOf(card.image)}`} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />}
      <span className="rp-fb">{name}</span>
      {power !== undefined && <span className="rp-pw">{power}</span>}
    </button>
  )
}

const Back = ({ title, cls = '' }: { title: string; cls?: string }) => (
  <div className={`rp-card rp-back ${cls}`} title={title} aria-label={title}>
    <span>?</span>
  </div>
)

export interface PanelProps {
  index: 0 | 1
  /** dónde se dibuja el panel: por defecto J1 abajo y J2 arriba; en una partida en vivo, quien juega siempre abajo */
  pos?: 'top' | 'bot'
  p: ReplayPlayer
  deckName: string
  active: boolean
  showHands: boolean
  prev: Map<string, number> | null
  onPick: (id: string) => void
}

export function PlayerPanel({ index, pos, p, deckName, active, showHands, prev, onPick }: PanelProps) {
  const who = index + 1
  const ed = eddiesOf(p)
  const spentEddies = p.e[0] - p.e[1]
  const seen = new Map<string, number>()
  const nth = (zone: string, id: string): [string, number] => {
    const k = `${index}|${zone}|${id}`
    const n = (seen.get(k) ?? 0) + 1
    seen.set(k, n)
    return [k, n]
  }
  return (
    <section className={`rp-pl ${index === 0 ? 'p1' : 'p2'} ${pos ?? (index === 0 ? 'bot' : 'top')}${active ? ' active' : ''}`} aria-label={`Jugador ${who}`}>
      <div className="rp-tag">
        <span className="rp-who">J{who}</span>
        <span className="rp-deckname" title={deckName}>{deckName}</span>
        <span className="rp-counts">Mazo {p.d} · Basura {p.t}</span>
        {active && <span className="rp-now">● su turno</span>}
      </div>

      <div className="rp-zone rp-zone-hand">
        <h4 className="rp-zt">Mano <span>{p.h.length} cartas</span></h4>
        <div className="rp-hand" aria-label={`Mano de J${who}: ${p.h.length} cartas`}>
          {p.h.length === 0 && <span className="muted small">Mano vacía</span>}
          {p.h.map((id, k) => {
            if (id === null || !showHands) return <Back key={`h${k}`} title="Carta oculta" />
            const [key, n] = nth('h', id)
            return <CardFace key={`${id}${k}`} id={id} isNew={isNewCopy(prev, key, n)} onPick={onPick} />
          })}
        </div>
      </div>

      <div className="rp-zones">
        <div className="rp-zone" aria-label="Zona de Legends">
          <h4 className="rp-zt">Legends <span>{ed.legends} en la zona · 1 € cada una</span></h4>
          <div className="rp-legs">
            {ed.legends === 0 && <span className="muted small">ninguna: bajaron al campo</span>}
            {/* una Legend que baja al campo (Go Solo) sale de la zona de Legends: pasa a ser una Unidad en mesa */}
            {p.l.map((l, k) => {
              const [id, up, ready, gone] = l
              if (gone) return null
              if (up && id !== null) return <CardFace key={`${id}${k}`} id={id} spent={!ready} onPick={onPick} />
              const name = showHands && id !== null ? `${catalog.byId[id]?.displayName ?? id} (boca abajo)` : 'Legend boca abajo'
              return <Back key={`${id ?? 'x'}${k}`} title={name} cls={!ready ? 'spent' : ''} />
            })}
          </div>
        </div>

        <div className="rp-zone" aria-label="Zona de Eddies">
          <h4 className="rp-zt">Eddies <span>{ed.ready}/{ed.total} disponibles</span></h4>
          <div className="rp-eddycards" title="Cada carta vendida queda boca abajo y da 1 Eddie; al gastarla se gira">
            {p.e[0] === 0 && <span className="muted small">ninguna carta vendida</span>}
            {Array.from({ length: p.e[0] }, (_, k) => (
              <div key={k} className={`rp-eddycard${k >= p.e[0] - spentEddies ? ' spent' : ''}`} title={k >= p.e[0] - spentEddies ? 'Eddie gastado' : 'Eddie disponible'} />
            ))}
          </div>
          <span className="rp-hint">{ed.loose} vendidas + {ed.legends} Legends</span>
        </div>

        <div className="rp-zone" aria-label="Zona de Gigs">
          <h4 className="rp-zt">Gigs <span>{p.g.length}/7</span></h4>
          <div className="rp-dicebox">
            {p.g.length === 0 ? <span className="muted small">sin Gigs</span> : p.g.map((g, k) => <Die key={k} max={g[0]} value={g[1]} owner={dieOwner(g, index)} holder={index} />)}
          </div>
          <span className="rp-cred" title="Street Cred = suma de los valores de tus Gigs (un dado robado cuenta para quien lo tiene)">
            Street Cred: <b>{streetCred(p)}</b> <i>(suma de tus Gigs)</i>
          </span>
        </div>

        <div className="rp-zone" aria-label="Fixer">
          <h4 className="rp-zt">Fixer <span>dados sin tirar</span></h4>
          <div className="rp-dicebox">
            {p.x.length === 0 ? <span className="muted small">vacío</span> : p.x.map((m, k) => <Die key={k} max={m} value={null} owner={index} holder={index} />)}
          </div>
        </div>
      </div>

      <div className="rp-zone rp-zone-field" aria-label={`Unidades de J${who}`}>
        <h4 className="rp-zt">Unidades en mesa <span>{p.f.length}</span></h4>
        <div className="rp-field">
          {p.f.length === 0 && <span className="muted small">Sin Unidades en mesa</span>}
          {p.f.map((u, k) => {
            const [id, power, ready, lag, gear, solo] = u
            const [key, n] = nth('f', id)
            return (
              <div className="rp-unit" key={`${id}${k}`}>
                <CardFace id={id} power={power} spent={!ready} lag={!!lag && !!ready} solo={!!solo} isNew={isNewCopy(prev, key, n)} onPick={onPick} />
                {gear.length > 0 && (
                  <div className="rp-gear" title={gear.map((g) => catalog.byId[g]?.displayName ?? g).join(', ')}>
                    {gear.map((g) => (catalog.byId[g]?.displayName ?? g).split(':')[0]).join(' · ')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/** Texto de reglas de la carta tocada (o una indicación si no hay ninguna). */
export function CardDetail({ id, cards }: { id: string | null; cards: Record<string, ReplayCardInfo> }) {
  const card = id ? catalog.byId[id] : undefined
  const info = id ? cards[id] : undefined
  return (
    <div className="rp-detail">
      {card ? (
        <>
          <CardFace id={card.id} onPick={() => {}} />
          <div>
            <h3>{card.displayName}</h3>
            <p className="rp-meta">
              {card.type}{card.color ? ` · ${card.color}` : ''}{card.cost !== null ? ` · coste ${card.cost}` : ''}
              {card.power !== null ? ` · poder ${card.power}` : ''}{info?.s ? ' · vendible' : ''}
            </p>
            <p>{card.rules || 'Sin texto de reglas.'}</p>
          </div>
        </>
      ) : (
        <p className="muted small" style={{ gridColumn: '1 / -1' }}>Toca una carta para ver su texto.</p>
      )}
    </div>
  )
}

export function ReplayBoard({ game, cards }: { game: ReplayGame; cards: Record<string, ReplayCardInfo> }) {
  const last = game.steps.length - 1
  const [rawIdx, setIdx] = useState(0)
  // la partida puede cambiar por una más corta antes de que el efecto de abajo vuelva al principio: el índice nunca se sale
  const idx = Math.min(rawIdx, last)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [showHands, setShowHands] = useState(true)
  const [picked, setPicked] = useState<string | null>(null)
  const logRef = useRef<HTMLOListElement>(null)

  // al cambiar de partida se vuelve al principio
  useEffect(() => {
    setIdx(0)
    setPlaying(false)
    setPicked(null)
  }, [game])

  useEffect(() => {
    if (!playing) return
    const t = window.setInterval(() => setIdx((i) => Math.min(last, i + 1)), STEP_MS / speed)
    return () => window.clearInterval(t)
  }, [playing, speed, last])

  useEffect(() => {
    if (playing && idx >= last) setPlaying(false)
  }, [idx, last, playing])

  useEffect(() => {
    const box = logRef.current
    const cur = box?.children[idx] as HTMLElement | undefined
    if (box && cur) box.scrollTop = Math.max(0, cur.offsetTop - box.clientHeight * 0.55)
  }, [idx, game])

  const go = (i: number) => {
    setPlaying(false)
    setIdx(Math.max(0, Math.min(last, i)))
  }
  const togglePlay = () => {
    if (playing) return setPlaying(false)
    if (idx >= last) setIdx(0)
    setPlaying(true)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
      if (e.key === 'ArrowRight') go(idx + 1)
      else if (e.key === 'ArrowLeft') go(idx - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const [line, stateIx] = game.steps[idx]
  const state = game.states[stateIx]
  const prev = useMemo(() => (idx > 0 ? zoneCounts(game.states[game.steps[idx - 1][1]]) : null), [game, idx])
  const who = whoOf(line)
  const end = isEnd(line)

  return (
    <div className="rp">
      <div className="rp-bar">
        <button className="btn" onClick={() => go(0)} aria-label="Al principio" title="Al principio">⏮</button>
        <button className="btn" onClick={() => go(idx - 1)} aria-label="Paso anterior" title="Paso anterior (←)">◀</button>
        <button className="btn primary" onClick={togglePlay} aria-label={playing ? 'Pausa' : 'Reproducir'} title="Reproducir / pausa">{playing ? '⏸' : '▶'}</button>
        <button className="btn" onClick={() => go(idx + 1)} aria-label="Paso siguiente" title="Paso siguiente (→)">▶|</button>
        <button className="btn" onClick={() => go(last)} aria-label="Al final" title="Al final">⏭</button>
        <select className="input rp-speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Velocidad">
          {SPEEDS.map((s) => <option key={s} value={s}>{String(s).replace('.', ',')}×</option>)}
        </select>
        <input className="rp-seek" type="range" min={0} max={last} value={idx} onChange={(e) => go(Number(e.target.value))} aria-label="Posición en la partida" />
        <span className="rp-stepinfo" aria-live="off">{idx + 1} / {game.steps.length}</span>
        <label className="rp-chk"><input type="checkbox" checked={showHands} onChange={(e) => setShowHands(e.target.checked)} /> Ver manos</label>
      </div>

      <div className="rp-layout">
        <div className="rp-board">
          <PlayerPanel index={1} p={state.p[1]} deckName={game.b} active={who === 2} showHands={showHands} prev={prev} onPick={setPicked} />
          <div className="rp-mid" role="status">
            <span className="rp-tn">Turno {state.n}</span>
            <span className={`rp-msg ${end ? 'end' : who ? `j${who}` : ''}`}>{stepLabel(line, true)}</span>
          </div>
          <PlayerPanel index={0} p={state.p[0]} deckName={game.a} active={who === 1} showHands={showHands} prev={prev} onPick={setPicked} />
          <p className="muted small rp-key">
            <span><i className="rp-dot j1" /> J1 (empieza)</span> <span><i className="rp-dot j2" /> J2</span>{' '}
            Carta girada = gastada · «Lag» = aún no puede actuar · número = poder actual · Eddies = cartas vendidas boca abajo + 1 por cada Legend · dados: cada color es de un jugador (el borde discontinuo marca un dado robado)
          </p>
        </div>

        <aside className="rp-side">
          <div className="rp-console">
            <h2>Consola de acciones</h2>
            <ol className="rp-log" ref={logRef}>
              {game.steps.map(([text], k) => {
                const cls = ['rp-line', ...lineKinds(text), k === idx && 'cur', k > idx && 'future'].filter(Boolean).join(' ')
                return (
                  <li key={k}>
                    <button type="button" className={cls} onClick={() => go(k)}>{stepLabel(text)}</button>
                  </li>
                )
              })}
            </ol>
          </div>
          <CardDetail id={picked} cards={cards} />
        </aside>
      </div>
    </div>
  )
}

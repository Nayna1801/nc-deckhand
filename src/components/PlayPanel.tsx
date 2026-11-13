import { useEffect, useState } from 'react'
import { playCommand, resultText, type DeckOption, type PlayAsk, type PlayEnd, type PlayMessage } from '../lib/play'
import { LabDeckSelect } from './LabDeckSelect'
import { PlayBoard } from './PlayBoard'
import { ReplayBoard } from './ReplayBoard'

type First = 'me' | 'pilot' | 'random'

interface Props {
  options: DeckOption[]
  defaultMine: string
  defaultRival: string
  onPlayingChange?: (playing: boolean) => void
}

const payload = (d: DeckOption) => ({ name: d.name, legends: d.legends, main: d.main })

/** Modo «Jugar»: eliges dos mazos y juegas contra el piloto del simulador; cada decisión se guarda para compararla con la suya. */
export function PlayPanel({ options, defaultMine, defaultRival, onPlayingChange }: Props) {
  const [mineKey, setMineKey] = useState(defaultMine)
  const [rivalKey, setRivalKey] = useState(defaultRival)
  const [seed, setSeed] = useState(1)
  const [first, setFirst] = useState<First>('me')
  const [strong, setStrong] = useState(true)
  const [choosePay, setChoosePay] = useState(true)
  const [ask, setAsk] = useState<PlayAsk | null>(null)
  const [end, setEnd] = useState<PlayEnd | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [names, setNames] = useState<[string, string]>(['', ''])
  const [myLegends, setMyLegends] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const find = (key: string) => options.find((o) => o.key === key)

  // si el mazo elegido ya no está en la lista (o aún no cargó), se usa el primero
  useEffect(() => {
    if (options.length && !options.some((o) => o.key === mineKey)) setMineKey(options[0].key)
    if (options.length && !options.some((o) => o.key === rivalKey)) setRivalKey((options[1] ?? options[0]).key)
  }, [options, mineKey, rivalKey])

  const handle = (msg: PlayMessage) => {
    if (msg.type === 'ask') {
      setAsk(msg)
      setLines((l) => [...l, ...msg.log])
      if (msg.names) setNames(msg.names)
    } else if (msg.type === 'end') {
      setAsk(null)
      setEnd(msg)
      setLines((l) => [...l, ...msg.log])
    } else if (msg.type === 'error') {
      setError(msg.message)
    }
  }

  const run = async (fn: () => Promise<PlayMessage>) => {
    setBusy(true)
    setError('')
    try {
      handle(await fn())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const start = (seedNow: number) => {
    const mine = find(mineKey)
    const rival = find(rivalKey)
    if (!mine || !rival) return setError('Elige los dos mazos.')
    setSeed(seedNow)
    setMyLegends(mine.legends)
    setAsk(null)
    setEnd(null)
    setLines([])
    const humanFirst = first === 'me' ? true : first === 'pilot' ? false : Math.random() < 0.5
    void run(() => playCommand({ cmd: 'start', mine: payload(mine), rival: payload(rival), seed: seedNow, human_first: humanFirst, strong, choose_pay: choosePay }))
  }

  const choose = (index: number) => ask && void run(() => playCommand({ cmd: 'answer', n: ask.n, choice: index }))

  const leave = async () => {
    setBusy(true)
    try {
      await playCommand({ cmd: 'abort' })
    } catch {
      // da igual: la siguiente partida cierra la anterior
    } finally {
      setAsk(null)
      setEnd(null)
      setLines([])
      setBusy(false)
    }
  }

  const playing = ask !== null
  useEffect(() => {
    onPlayingChange?.(playing)
  }, [playing, onPlayingChange])

  return (
    <div>
      {!playing && (
        <div className="panel lab-form">
          <LabDeckSelect label="Tu mazo" value={mineKey} onChange={setMineKey} options={options} />
          <LabDeckSelect label="Mazo del piloto" value={rivalKey} onChange={setRivalKey} options={options} />
          <label className="lab-field narrow">
            <span>Semilla</span>
            <input className="input" type="number" min={0} step={1} value={seed} onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
          </label>
          <label className="lab-field narrow">
            <span>Empieza</span>
            <select className="input" value={first} onChange={(e) => setFirst(e.target.value as First)}>
              <option value="me">Yo</option>
              <option value="pilot">El piloto</option>
              <option value="random">Al azar</option>
            </select>
          </label>
          <label className="rp-chk" title="Con la red aprendida el piloto juega mejor; sin ella usa la valoración a mano">
            <input type="checkbox" checked={strong} onChange={(e) => setStrong(e.target.checked)} /> Piloto fuerte
          </label>
          <label className="rp-chk" title="Al pagar puedes elegir qué Legends gastas (el resto sale de los Eddies sueltos). Desmarcado, se paga solo como lo haría el piloto">
            <input type="checkbox" checked={choosePay} onChange={(e) => setChoosePay(e.target.checked)} /> Elegir con qué pago
          </label>
          <div className="lab-actions">
            <button className="btn primary" onClick={() => start(seed)} disabled={busy || !options.length}>{busy ? 'Preparando…' : 'Empezar partida'}</button>
          </div>
        </div>
      )}

      {error && (
        <div className="banner" role="alert">
          {error} {playing && <button className="btn" onClick={() => void leave()}>Volver</button>}
        </div>
      )}

      {playing && ask && <PlayBoard ask={ask} names={names} myLegends={myLegends} lines={lines} busy={busy} onChoose={choose} onAbort={() => void leave()} />}

      {!playing && end && (
        <>
          <div className="panel pb-result">
            <h3>{resultText(end)}</h3>
            <p className="muted small">
              Turno {end.game.turns} · Gigs {end.game.states[end.game.states.length - 1]?.p[0].g.length}–{end.game.states[end.game.states.length - 1]?.p[1].g.length} (J1–J2)
              {end.saved ? <> · decisiones guardadas en <code>{end.saved}</code></> : ' · sin decisiones que guardar'}
            </p>
            <div className="lab-actions">
              <button className="btn primary" onClick={() => start(seed + 1)} disabled={busy}>Otra partida (semilla {seed + 1})</button>
              <button className="btn" onClick={() => void leave()} disabled={busy}>Cambiar mazos</button>
            </div>
          </div>
          <h3>Repaso de la partida (con las manos de los dos)</h3>
          <ReplayBoard key={end.game.seed + end.game.title} game={end.game} cards={end.cards} />
        </>
      )}

      {!playing && !end && !error && <p className="muted">Elige los mazos y pulsa «Empezar partida». Las 1-9 del teclado eligen una opción.</p>}
    </div>
  )
}

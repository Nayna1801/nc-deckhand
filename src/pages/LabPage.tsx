import { useEffect, useMemo, useState } from 'react'
import { LabDeckSelect } from '../components/LabDeckSelect'
import { PlayPanel } from '../components/PlayPanel'
import { ReplayBoard } from '../components/ReplayBoard'
import type { DeckOption } from '../lib/play'
import type { ReplayCardInfo, ReplayGame, SimulateResponse } from '../lib/replay'
import { useData } from '../state/DataContext'
import '../lab.css'

/**
 * Laboratorio: simula partidas con el motor de tools/deckforge y las enseña paso a paso, o te deja jugar contra su piloto.
 * SOLO existe con `npm run dev`
 * (el simulador es Python y corre en tu equipo a través del servidor de desarrollo: scripts/lab-api.mjs); no se compila.
 */

interface Played {
  id: number
  game: ReplayGame
  cards: Record<string, ReplayCardInfo>
}

const DEFAULT_A = 'decks/consistente_goro_wakako_v'
const DEFAULT_B = 'meta/bbg_control'

async function post(url: string, body: unknown): Promise<SimulateResponse> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status} del simulador`)
  return data as unknown as SimulateResponse
}

export function LabPage() {
  const { decks, guestDecks, loggedIn } = useData()
  const [forge, setForge] = useState<DeckOption[]>([])
  const [engineError, setEngineError] = useState('')
  const [aKey, setAKey] = useState(DEFAULT_A)
  const [bKey, setBKey] = useState(DEFAULT_B)
  const [seed, setSeed] = useState(1)
  const [deep, setDeep] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [played, setPlayed] = useState<Played[]>([])
  const [current, setCurrent] = useState<number | null>(null)
  const [mode, setMode] = useState<'watch' | 'play'>('watch')
  const [playing, setPlaying] = useState(false) // jugando una partida en vivo: la mesa ocupa la pantalla y se oculta la cabecera

  useEffect(() => {
    let cancelled = false
    fetch('/__lab/decks')
      .then(async (r) => {
        const data = (await r.json()) as DeckOption[] | { error: string }
        if (!r.ok || !Array.isArray(data)) throw new Error(Array.isArray(data) ? `Error ${r.status}` : data.error)
        if (!cancelled) setForge(data)
      })
      .catch((e: unknown) => !cancelled && setEngineError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [])

  const web = useMemo<DeckOption[]>(
    () =>
      (loggedIn ? decks : guestDecks).map((d) => ({
        key: `web/${d.id}`,
        group: 'Mis mazos (web)',
        name: d.name,
        legends: [...new Set(d.legendIds)].slice(0, 3),
        main: Object.entries(d.main).flatMap(([id, n]) => Array.from({ length: n }, () => id)),
      })),
    [decks, guestDecks, loggedIn],
  )
  const options = useMemo(() => [...web, ...forge], [web, forge])
  const find = (key: string) => options.find((o) => o.key === key)

  // si el mazo elegido ya no está en la lista (o aún no cargó), se usa el primero
  useEffect(() => {
    if (options.length && !find(aKey)) setAKey(options[0].key)
    if (options.length && !find(bKey)) setBKey((options[1] ?? options[0]).key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options])

  const run = async (seedNow: number) => {
    const a = find(aKey)
    const b = find(bKey)
    if (!a || !b) return setError('Elige los dos mazos.')
    setBusy(true)
    setError('')
    try {
      const payload = (d: DeckOption) => ({ name: d.name, legends: d.legends, main: d.main })
      const res = await post('/__lab/simulate', { a: payload(a), b: payload(b), seed: seedNow, deep })
      const entry: Played = { id: Date.now(), game: res.game, cards: res.cards }
      setPlayed((list) => [entry, ...list].slice(0, 30))
      setCurrent(entry.id)
      setSeed(seedNow)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const shown = played.find((p) => p.id === current) ?? null

  return (
    <div className={`lab${playing ? ' playing' : ''}`}>
      {!playing && <h2>Laboratorio</h2>}
      {!playing && <p className="muted small">
        Solo visible mientras ejecutas <code>npm run dev</code>: no existe en la web publicada. Simula una partida completa con el motor de
        <code> tools/deckforge</code> y la reproduce paso a paso, o juegas tú contra su piloto. Para ver un mazo contra sí mismo, elige el mismo en los dos lados.
      </p>}

      {!playing && (
        <div className="seg lab-mode" role="tablist" aria-label="Modo del Laboratorio">
          <button role="tab" aria-selected={mode === 'watch'} className={mode === 'watch' ? 'on' : ''} onClick={() => setMode('watch')}>Ver simulación</button>
          <button role="tab" aria-selected={mode === 'play'} className={mode === 'play' ? 'on' : ''} onClick={() => setMode('play')}>Jugar contra el piloto</button>
        </div>
      )}

      {engineError && (
        <div className="banner" role="alert">
          No se pudo conectar con el simulador: {engineError}. Comprueba que Python está instalado (o define NCD_PYTHON con su ruta).
        </div>
      )}

      <div hidden={mode !== 'play'}>
        <PlayPanel options={options} defaultMine={DEFAULT_A} defaultRival={DEFAULT_B} onPlayingChange={setPlaying} />
      </div>

      <div hidden={mode !== 'watch'}>
      <div className="panel lab-form">
        <LabDeckSelect label="J1 (empieza)" value={aKey} onChange={setAKey} options={options} />
        <LabDeckSelect label="J2" value={bKey} onChange={setBKey} options={options} />
        <label className="lab-field narrow">
          <span>Semilla</span>
          <input className="input" type="number" min={0} step={1} value={seed} onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        </label>
        <label className="rp-chk" title="Con previsión el piloto prueba varios planes cada turno: juega mejor pero tarda más">
          <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} /> Piloto con previsión
        </label>
        <div className="lab-actions">
          <button className="btn primary" onClick={() => void run(seed)} disabled={busy || !options.length}>{busy ? 'Simulando…' : 'Simular'}</button>
          <button className="btn" onClick={() => void run(seed + 1)} disabled={busy || !options.length} title="Misma pareja de mazos con la semilla siguiente">Otra partida</button>
        </div>
      </div>

      {error && <div className="banner" role="alert">{error}</div>}

      {played.length > 1 && (
        <label className="lab-field history">
          <span>Partidas simuladas en esta sesión</span>
          <select className="input" value={current ?? ''} onChange={(e) => setCurrent(Number(e.target.value))}>
            {played.map((p) => (
              <option key={p.id} value={p.id}>
                {p.game.a} (J1) vs {p.game.b} (J2) · semilla {p.game.seed} · {p.game.winner < 0 ? 'empate' : `gana J${p.game.winner + 1}`} · turno {p.game.turns}
              </option>
            ))}
          </select>
        </label>
      )}

      {shown ? (
        <>
          <p className="lab-result">
            <b>{shown.game.winner < 0 ? 'Empate' : `Gana J${shown.game.winner + 1}`}</b> en el turno {shown.game.turns} · semilla {shown.game.seed} · {shown.game.steps.length} pasos
          </p>
          <ReplayBoard key={shown.id} game={shown.game} cards={shown.cards} />
        </>
      ) : (
        <p className="muted">Elige dos mazos y pulsa «Simular».</p>
      )}
      </div>
    </div>
  )
}

export default LabPage

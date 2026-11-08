import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { catalog } from '../lib/catalog'
import { thumbOf } from '../lib/images'
import { printsOf } from '../lib/prints'
import { describeVariants, findCandidates, guideRect, loadAtlas, type Atlas, type Candidate } from '../lib/scan/atlas'
import { variantsOf } from '../lib/variants'

/** Parte de la imagen que ocupa el marco guía en la cámara y en las fotos subidas. */
const CAMERA_GUIDE = 0.8
const PHOTO_GUIDE = 0.92

const STATS_KEY = 'ncd.scan.stats.v1'

interface Stats {
  scans: number
  /** Cuántas veces la carta correcta fue la 1ª, 2ª o 3ª candidata. */
  rank: [number, number, number]
  /** Veces que ninguna de las candidatas era la carta. */
  none: number
}

const EMPTY_STATS: Stats = { scans: 0, rank: [0, 0, 0], none: 0 }

function loadStats(): Stats {
  try {
    const raw = JSON.parse(localStorage.getItem(STATS_KEY) ?? 'null') as Partial<Stats> | null
    if (!raw || !Array.isArray(raw.rank)) return EMPTY_STATS
    const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0))
    return { scans: n(raw.scans), rank: [n(raw.rank[0]), n(raw.rank[1]), n(raw.rank[2])], none: n(raw.none) }
  } catch {
    return EMPTY_STATS
  }
}

function saveStats(s: Stats): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(s))
  } catch {
    /* sin almacenamiento: las estadísticas solo duran lo que dure la página */
  }
}

const pct = (n: number, d: number) => (d === 0 ? '–' : `${Math.round((n / d) * 100)} %`)

function describeCandidate(c: Candidate): { name: string; art: string; printKey?: string; cardId: string; arts: number } {
  const card = catalog.byId[c.ref.card]
  const variants = card ? variantsOf(card) : []
  const v = c.ref.art ? variants.find((x) => x.key === c.ref.art) : undefined
  const printKey = c.ref.art ? printsOf(card).find((p) => p.variantKey === c.ref.art)?.key : undefined
  return { name: card?.displayName ?? c.ref.card, art: c.ref.art ? (v?.label ?? 'Arte alternativo') : 'Diseño base', printKey, cardId: c.ref.card, arts: variants.length }
}

function cameraMessage(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'No hay permiso para usar la cámara. Actívalo en los ajustes del navegador para esta web.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No se encontró ninguna cámara en este dispositivo.'
  if (name === 'NotReadableError') return 'La cámara está en uso por otra aplicación.'
  return 'No se pudo abrir la cámara. Puedes hacer una foto y subirla.'
}

/** La carta que el usuario ha confirmado entre las candidatas del escáner. */
export interface ScanChoice {
  cardId: string
  /** Impresión concreta (si se reconoció un arte alternativo). */
  printKey?: string
  name: string
}

interface ScannerProps {
  /** Se llama al pulsar el botón de una candidata. */
  onChoose: (choice: ScanChoice) => void
  /** Texto del botón de cada candidata. */
  chooseLabel?: string
  /** Contenido extra bajo las candidatas (p. ej. qué se ha hecho con la última elegida). */
  footer?: ReactNode
}

/** Escáner de cartas con la cámara (o una foto): propone las 3 cartas más parecidas. Lo usan la página Escanear y el constructor de mazos. */
export function Scanner({ onChoose, chooseLabel = 'Es esta', footer }: ScannerProps) {
  const video = useRef<HTMLVideoElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const resultsBox = useRef<HTMLElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [atlas, setAtlas] = useState<Atlas | null>(null)
  const [atlasError, setAtlasError] = useState('')
  const [camera, setCamera] = useState<'off' | 'starting' | 'on'>('off')
  const [cameraError, setCameraError] = useState('')
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [results, setResults] = useState<Candidate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [answered, setAnswered] = useState(false)
  const [scanId, setScanId] = useState(0)
  const [scanMs, setScanMs] = useState<number | null>(null)
  const [stats, setStats] = useState<Stats>(loadStats)

  // el atlas (huellas de todas las cartas) se prepara nada más entrar: son ~1 MB y unos milisegundos de cálculo
  useEffect(() => {
    let alive = true
    loadAtlas().then((a) => alive && setAtlas(a), (e: unknown) => alive && setAtlasError(e instanceof Error ? e.message : 'No se pudo preparar el escáner.'))
    return () => {
      alive = false
    }
  }, [])

  // al activar la cámara, la página se desplaza hasta que el visor ocupa la pantalla
  useEffect(() => {
    if (camera === 'off') return
    stage.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [camera])

  const stopCamera = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
    setCamera('off')
    setSize(null)
  }, [])
  useEffect(() => stopCamera, [stopCamera])

  const startCamera = async () => {
    setCameraError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Este navegador no permite usar la cámara (hace falta una conexión segura). Puedes hacer una foto y subirla.')
      return
    }
    setCamera('starting')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })
      stream.current = s
      const el = video.current
      if (!el) return stopCamera()
      el.srcObject = s
      await el.play().catch(() => undefined)
      if (el.videoWidth) setSize({ w: el.videoWidth, h: el.videoHeight })
      setCamera('on')
    } catch (e) {
      stopCamera()
      setCameraError(cameraMessage(e))
    }
  }

  const show = (r: Candidate[]) => {
    setResults(r)
    setAnswered(false)
    setScanId((n) => n + 1)
    // el visor ocupa toda la pantalla: se baja a las candidatas (tras pintarlas) para no obligar a buscarlas
    window.requestAnimationFrame(() => resultsBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const backToCamera = () => stage.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const scanFrame = () => {
    const el = video.current
    if (!atlas || !el || !el.videoWidth) return
    setBusy(true)
    try {
      const t0 = performance.now()
      const rect = guideRect(el.videoWidth, el.videoHeight, CAMERA_GUIDE)
      const found = findCandidates(atlas, describeVariants(el, rect, el.videoWidth, el.videoHeight))
      setScanMs(Math.round(performance.now() - t0))
      show(found)
    } finally {
      setBusy(false)
    }
  }

  const scanFile = async (file: File) => {
    if (!atlas) return
    setBusy(true)
    setCameraError('')
    try {
      const bmp = await createImageBitmap(file)
      try {
        const t0 = performance.now()
        const found = findCandidates(atlas, describeVariants(bmp, guideRect(bmp.width, bmp.height, PHOTO_GUIDE), bmp.width, bmp.height))
        setScanMs(Math.round(performance.now() - t0))
        show(found)
      } finally {
        bmp.close()
      }
    } catch {
      setCameraError('No se pudo leer esa imagen.')
    } finally {
      setBusy(false)
    }
  }

  const record = (rank: number | 'none') => {
    if (answered) return
    setAnswered(true)
    const next: Stats = { scans: stats.scans + 1, rank: [...stats.rank], none: stats.none }
    if (rank === 'none') next.none += 1
    else next.rank[rank] += 1
    setStats(next)
    saveStats(next)
  }

  const hits = stats.rank[0] + stats.rank[1] + stats.rank[2]
  const guide = size ? guideRect(size.w, size.h, CAMERA_GUIDE) : null

  return (
    <div className="scanner">
      {atlasError && <p className="notice" role="alert">{atlasError}</p>}
        {!atlas && !atlasError && <p className="muted small" role="status">Preparando el escáner…</p>}

        <div
          ref={stage}
          className="scan-stage"
          style={size ? ({ '--ar': size.w / size.h } as React.CSSProperties) : undefined}
          hidden={camera === 'off'}
        >
          <video ref={video} playsInline muted autoPlay aria-label="Vista de la cámara" />
          {guide && size && (
            <div
              className="scan-guide"
              aria-hidden="true"
              style={{ left: `${(guide.x / size.w) * 100}%`, top: `${(guide.y / size.h) * 100}%`, width: `${(guide.w / size.w) * 100}%`, height: `${(guide.h / size.h) * 100}%` }}
            />
          )}
          <div className="scan-overlay">
            <button className="btn primary scan-shot" disabled={!atlas || busy || camera !== 'on'} onClick={scanFrame}>Escanear</button>
            <button className="btn" onClick={stopCamera}>Apagar cámara</button>
          </div>
        </div>

        <div className="row wrap scan-actions">
          {camera === 'off' && <button className="btn primary" onClick={() => void startCamera()}>📷 Activar cámara</button>}
          <button className="btn" disabled={!atlas || busy} onClick={() => fileInput.current?.click()}>Subir o hacer una foto</button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            aria-label="Foto de la carta"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void scanFile(f)
            }}
          />
        </div>
        {cameraError && <p className="notice small" role="alert">{cameraError}</p>}

        {results && (
          <section ref={resultsBox} className="scan-results-box" aria-label="Candidatas" data-scan={scanId}>
            <h2>Se parece a…</h2>
            <ol className="scan-results">
              {results.map((c, i) => {
                const d = describeCandidate(c)
                return (
                  <li key={`${c.index}`} className="scan-result">
                    <img src={`${import.meta.env.BASE_URL}${thumbOf(c.ref.image)}`} alt="" loading="lazy" draggable={false} />
                    <span className="scan-info">
                      <strong>{d.name}</strong>
                      <small className="muted">{d.art}{c.ref.also.length > 0 ? ' · misma imagen en otras versiones' : ''}</small>
                      {d.arts > 0 && <small className="muted">Tiene {d.arts} {d.arts === 1 ? 'arte alternativo' : 'artes alternativos'}: confirma cuál es en el detalle.</small>}
                    </span>
                    <span className="pill" title="Parecido con la foto. No es una probabilidad: un acierto con mala luz puede dar un número bajo">{Math.round(Math.max(0, c.score) * 100)} %</span>
                    <button
                      className="btn sm primary"
                      onClick={() => {
                        record(i)
                        onChoose({ cardId: d.cardId, printKey: d.printKey, name: d.name })
                      }}
                    >
                      {chooseLabel}
                    </button>
                  </li>
                )
              })}
            </ol>
            <div className="row wrap">
              <button className="btn sm ghost" disabled={answered} onClick={() => record('none')}>Ninguna es</button>
              {camera === 'on' && <button className="btn sm" onClick={backToCamera}>↑ Escanear otra</button>}
              {scanMs !== null && <span className="muted small" data-ms={scanMs}>Calculado en {scanMs} ms en este dispositivo.</span>}
              <span className="muted small">Pulsar «Es esta» o «Ninguna es» solo apunta, en este dispositivo, si el escáner acertó: sirve para medir la precisión real.</span>
            </div>
          </section>
        )}

        <details className="scan-stats">
          <summary>Precisión medida en este dispositivo ({stats.scans} {stats.scans === 1 ? 'escaneo' : 'escaneos'})</summary>
          {stats.scans === 0 ? (
            <p className="muted small">Todavía no hay datos. Escanea cartas y pulsa «Es esta» sobre la correcta, o «Ninguna es» si no aparece.</p>
          ) : (
            <ul className="plain small">
              <li>A la primera: <strong>{pct(stats.rank[0], stats.scans)}</strong> ({stats.rank[0]})</li>
              <li>Entre las 3 candidatas: <strong>{pct(hits, stats.scans)}</strong> ({hits})</li>
              <li>No aparecía: {pct(stats.none, stats.scans)} ({stats.none})</li>
            </ul>
          )}
          <button className="btn sm ghost" onClick={() => { setStats(EMPTY_STATS); saveStats(EMPTY_STATS) }}>Borrar estadísticas</button>
        </details>
      {footer}
    </div>
  )
}

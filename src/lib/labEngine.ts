/**
 * Acceso al simulador de tools/deckforge desde la página «Laboratorio». Dos transportes con la misma interfaz:
 *  - en la web publicada, el motor corre en el navegador (Pyodide en un Worker: src/lab/engine.worker.ts);
 *  - con `npm run dev`, se usa el Python del equipo a través del servidor de desarrollo (scripts/lab-api.mjs), que además guarda
 *    las partidas en tools/deckforge/data/human/. Con VITE_LAB_ENGINE=pyodide se fuerza el motor del navegador también en desarrollo.
 */
import { useSyncExternalStore } from 'react'
import type { DeckOption, PlayMessage } from './play'
import type { SimulateResponse } from './replay'

export type EngineStatus = 'idle' | 'loading' | 'starting' | 'ready' | 'error'
export interface EngineState {
  status: EngineStatus
  message?: string
}

export type WorkerInbound = { init: { base: string } } | { id: number; req: Record<string, unknown> }
export type WorkerOutbound = { status: EngineStatus; message?: string } | { id: number; res: unknown } | { id: number; error: string }

export interface DeckPayload {
  name: string
  legends: string[]
  main: string[]
}

export const deckPayload = (d: DeckOption): DeckPayload => ({ name: d.name, legends: d.legends, main: d.main })

/** true: el motor corre en el navegador; false: en el Python del equipo (solo con `npm run dev`). */
export const IN_BROWSER = !import.meta.env.DEV || import.meta.env.VITE_LAB_ENGINE === 'pyodide'

// ---------------------------------------------------------------- estado del motor (para avisar mientras se descarga)
let state: EngineState = { status: IN_BROWSER ? 'idle' : 'ready' }
const listeners = new Set<() => void>()
const setState = (next: EngineState) => {
  state = next
  listeners.forEach((fn) => fn())
}
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export const useEngineState = (): EngineState => useSyncExternalStore(subscribe, () => state)

// ---------------------------------------------------------------- motor en el navegador
let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function failAll(message: string) {
  for (const w of waiting.values()) w.reject(new Error(message))
  waiting.clear()
}

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('../lab/engine.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<WorkerOutbound>) => {
    const msg = e.data
    if ('status' in msg) {
      setState({ status: msg.status, message: msg.message })
      if (msg.status === 'error') failAll(msg.message ?? 'el simulador no arrancó')
      return
    }
    const w8 = waiting.get(msg.id)
    if (!w8) return
    waiting.delete(msg.id)
    if ('error' in msg) w8.reject(new Error(msg.error))
    else w8.resolve(msg.res)
  }
  w.onerror = (e) => {
    const message = e.message || 'no se pudo cargar el simulador'
    setState({ status: 'error', message })
    failAll(message)
  }
  w.postMessage({ init: { base: new URL('.', document.baseURI).href } } satisfies WorkerInbound)
  worker = w
  return w
}

function inBrowser<T>(req: Record<string, unknown>): Promise<T> {
  if (state.status === 'error') return Promise.reject(new Error(state.message ?? 'el simulador no arrancó'))
  const w = getWorker()
  return new Promise<T>((resolve, reject) => {
    const id = nextId++
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject })
    w.postMessage({ id, req } satisfies WorkerInbound)
  }).then((res) => {
    const r = res as { type?: string; message?: string }
    if (req.cmd !== 'start' && req.cmd !== 'answer' && r?.type === 'error') throw new Error(r.message ?? 'error del simulador')
    return res
  })
}

// ---------------------------------------------------------------- motor en el Python del equipo (servidor de desarrollo)
async function devServer<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/__lab/${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status} del simulador`)
  return data as unknown as T
}

// ---------------------------------------------------------------- lo que usa la página
/** Mazos de tools/deckforge (decks/ y meta/). */
export async function labDecks(): Promise<DeckOption[]> {
  if (!IN_BROWSER) return devServer<DeckOption[]>('decks')
  return (await inBrowser<{ decks: DeckOption[] }>({ cmd: 'decks' })).decks
}

/** Simula una partida entera entre dos pilotos y la devuelve grabada paso a paso. */
export function labSimulate(body: { a: DeckPayload; b: DeckPayload; seed: number; deep: boolean }): Promise<SimulateResponse> {
  return IN_BROWSER ? inBrowser<SimulateResponse>({ cmd: 'simulate', ...body }) : devServer<SimulateResponse>('simulate', body)
}

/** Envía una orden (start, answer, abort) a la partida en vivo y devuelve el siguiente mensaje. Lanza si el motor falla. */
export function playCommand(cmd: Record<string, unknown>): Promise<PlayMessage> {
  return IN_BROWSER ? inBrowser<PlayMessage>(cmd) : devServer<PlayMessage>('play', cmd)
}

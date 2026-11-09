import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

export interface ConfirmOptions {
  title: string
  /** Texto de apoyo; admite varias líneas con \n. */
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Acción destructiva: el botón de confirmar sale en rojo. */
  danger?: boolean
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm | null>(null)

interface Pending {
  options: ConfirmOptions
  resolve: (ok: boolean) => void
}

/** Sustituye a window.confirm: mismo aspecto que el resto de la web, se puede usar con el teclado y en el móvil. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        // si ya había una pregunta abierta, se da por cancelada
        setPending((prev) => {
          prev?.resolve(false)
          return { options, resolve }
        })
      }),
    [],
  )

  const answer = useCallback((ok: boolean) => {
    setPending((prev) => {
      prev?.resolve(ok)
      return null
    })
  }, [])

  const value = useMemo(() => confirm, [confirm])
  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && <ConfirmDialog options={pending.options} onAnswer={answer} />}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): Confirm {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm debe usarse dentro de <ConfirmProvider>')
  return ctx
}

function ConfirmDialog({ options, onAnswer }: { options: ConfirmOptions; onAnswer: (ok: boolean) => void }) {
  const cancelBtn = useRef<HTMLButtonElement>(null)
  const confirmBtn = useRef<HTMLButtonElement>(null)
  const { title, message, confirmLabel = 'Continuar', cancelLabel = 'Cancelar', danger = false } = options

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    document.documentElement.classList.add('modal-open')
    cancelBtn.current?.focus({ preventScroll: true }) // por defecto «Cancelar»: un Intro de más no destruye nada
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onAnswer(false)
      } else if (e.key === 'Tab') {
        // el foco se queda dentro del cuadro: solo hay dos botones
        const first = cancelBtn.current
        const last = confirmBtn.current
        if (!first || !last) return
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.documentElement.classList.remove('modal-open')
      previous?.focus?.()
    }
  }, [onAnswer])

  return (
    <div className="modal-backdrop confirm-backdrop" onClick={() => onAnswer(false)} role="presentation">
      <div
        className={`confirm ${danger ? 'danger' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={message ? 'confirm-msg' : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        {message && <p id="confirm-msg" className="confirm-msg">{message}</p>}
        <div className="confirm-actions">
          <button ref={cancelBtn} type="button" className="btn" onClick={() => onAnswer(false)}>{cancelLabel}</button>
          <button ref={confirmBtn} type="button" className={`btn ${danger ? 'danger' : 'primary'}`} onClick={() => onAnswer(true)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

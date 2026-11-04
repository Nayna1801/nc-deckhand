import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import type { AuthIssue } from '../lib/authMessages'
import { hasSupabase } from '../lib/supabase'
import { useAuth } from '../state/AuthContext'

const RESEND_COOLDOWN_S = 30

type Msg = { kind: 'err' | 'ok'; text: string; /** acciones ofrecidas junto al mensaje */ goLogin?: boolean; resend?: boolean; detail?: string }

export function LoginPage() {
  const { user, signIn, signUp, resendConfirmation, loading } = useAuth()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<Msg | null>(null)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  // cuenta atrás para no poder spamear el reenvío del correo
  useEffect(() => {
    if (cooldown <= 0) return
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [cooldown])

  if (user) return <Navigate to="/collection" replace />

  const fromIssue = (i: AuthIssue): Msg => ({
    kind: 'err',
    text: i.text,
    goLogin: i.kind === 'exists',
    resend: i.kind === 'unconfirmed',
    detail: i.kind === 'other' ? i.detail : undefined,
  })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const mail = email.trim()
    if (mode === 'in') {
      const failure = await signIn(mail, password)
      if (failure) setMsg(fromIssue(failure))
    } else {
      const r = await signUp(mail, password)
      if (r.issue) setMsg(fromIssue(r.issue))
      else if (r.needsConfirmation) {
        setMsg({ kind: 'ok', text: `Te hemos enviado un correo a ${mail}. Pulsa el enlace para activar la cuenta (mira también el spam); te traerá de vuelta a esta web.`, resend: true })
        setCooldown(RESEND_COOLDOWN_S)
      }
    }
    setBusy(false)
  }

  const resend = async () => {
    const failure = await resendConfirmation(email.trim())
    if (failure) return setMsg(fromIssue(failure))
    setMsg({ kind: 'ok', text: `Correo reenviado a ${email.trim()}. Puede tardar un par de minutos.`, resend: true })
    setCooldown(RESEND_COOLDOWN_S)
  }

  const switchTo = (next: 'in' | 'up') => {
    setMode(next)
    setMsg(null)
  }

  if (!hasSupabase) {
    return (
      <section className="auth">
        <h1>Cuenta no disponible</h1>
        <p className="notice">Esta copia de la app no tiene Supabase configurado (faltan <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code>). Puedes seguir construyendo mazos como invitado.</p>
      </section>
    )
  }

  return (
    <section className="auth">
      <h1>{mode === 'in' ? 'Iniciar sesión' : 'Crear cuenta'}</h1>
      <p className="muted">Sin sesión puedes construir mazos. Con sesión se guardan en tu cuenta y llevas el registro de tus cartas.</p>
      <form onSubmit={submit} className="form">
        <label>Email<input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>
          Contraseña
          {/* la longitud mínima solo se exige al crear la cuenta: una cuenta compartida con otra app puede tener una contraseña más corta */}
          <input className="input" type="password" required minLength={mode === 'up' ? 8 : undefined} maxLength={72} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {mode === 'up' && <p className="muted small">Mínimo 8 caracteres. Si ya tienes cuenta en otra app de este proyecto, usa el mismo email y entra con tu contraseña de siempre.</p>}

        {msg && (
          <div className={msg.kind === 'err' ? 'errors' : 'notice'} role="alert">
            <p>{msg.text}</p>
            {msg.detail && <p className="muted small">Detalle técnico: {msg.detail}</p>}
            <div className="row wrap">
              {msg.goLogin && <button type="button" className="btn sm primary" onClick={() => switchTo('in')}>Ir a iniciar sesión</button>}
              {msg.resend && (
                <button type="button" className="btn sm" disabled={cooldown > 0 || !email.trim()} onClick={() => void resend()}>
                  {cooldown > 0 ? `Reenviar correo (${cooldown} s)` : 'Reenviar correo de confirmación'}
                </button>
              )}
            </div>
          </div>
        )}
        <button className="btn primary" disabled={busy || loading}>{busy ? 'Un momento…' : mode === 'in' ? 'Entrar' : 'Crear cuenta'}</button>
      </form>
      <button className="link-btn" onClick={() => switchTo(mode === 'in' ? 'up' : 'in')}>
        {mode === 'in' ? '¿No tienes cuenta? Créala' : '¿Ya tienes cuenta? Inicia sesión'}
      </button>
    </section>
  )
}

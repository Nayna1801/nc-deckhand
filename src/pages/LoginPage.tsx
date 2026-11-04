import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { hasSupabase } from '../lib/supabase'
import { useAuth } from '../state/AuthContext'

export function LoginPage() {
  const { user, signIn, signUp, loading } = useAuth()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/collection" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const err = mode === 'in' ? await signIn(email.trim(), password) : await signUp(email.trim(), password)
    setBusy(false)
    if (err === 'CONFIRM_EMAIL') setMsg({ kind: 'ok', text: 'Cuenta creada. Revisa tu correo para confirmar el email y después inicia sesión.' })
    else if (err) setMsg({ kind: 'err', text: err })
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
        <label>Contraseña<input className="input" type="password" required minLength={8} maxLength={72} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {msg && <p className={msg.kind === 'err' ? 'errors' : 'notice'} role="alert">{msg.text}</p>}
        <button className="btn primary" disabled={busy || loading}>{busy ? 'Un momento…' : mode === 'in' ? 'Entrar' : 'Crear cuenta'}</button>
      </form>
      <button className="link-btn" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null) }}>
        {mode === 'in' ? '¿No tienes cuenta? Créala' : '¿Ya tienes cuenta? Inicia sesión'}
      </button>
    </section>
  )
}

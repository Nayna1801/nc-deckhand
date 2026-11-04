import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { describeAuthError, isExistingUserResponse, issue, parseAuthLink, type AuthIssue } from '../lib/authMessages'
import { supabase } from '../lib/supabase'

export interface SignUpResult {
  issue: AuthIssue | null
  /** true si se ha enviado un correo y hay que pulsar su enlace antes de poder entrar. */
  needsConfirmation: boolean
}

export interface AuthNotice {
  kind: 'ok' | 'error'
  text: string
}

interface AuthState {
  user: User | null
  loading: boolean
  /** Aviso al volver desde el enlace de un correo (email confirmado, enlace caducado…). */
  notice: AuthNotice | null
  dismissNotice: () => void
  signIn: (email: string, password: string) => Promise<AuthIssue | null>
  signUp: (email: string, password: string) => Promise<SignUpResult>
  resendConfirmation: (email: string) => Promise<AuthIssue | null>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

/** Adónde debe volver el usuario al pulsar el enlace del correo: esta web, no la "Site URL" de otra app. */
const returnUrl = (): string => `${window.location.origin}${window.location.pathname}`

// Se lee UNA vez al cargar: después el router y supabase-js limpian el fragmento de la URL.
const INITIAL_LINK = typeof window !== 'undefined' ? parseAuthLink(window.location.hash) : { type: null, error: null }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(supabase !== null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setUser(data.session?.user ?? null)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null))
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const notice = useMemo<AuthNotice | null>(() => {
    if (dismissed) return null
    if (INITIAL_LINK.error) return { kind: 'error', text: INITIAL_LINK.error.text }
    if (!INITIAL_LINK.type) return null
    if (user) return { kind: 'ok', text: INITIAL_LINK.type === 'signup' ? 'Email confirmado: tu cuenta ya está activa.' : 'Sesión iniciada desde el enlace del correo.' }
    if (!loading) return { kind: 'error', text: issue('link').text }
    return null
  }, [dismissed, user, loading])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      notice,
      dismissNotice: () => setDismissed(true),
      signIn: async (email, password) => {
        if (!supabase) return issue('other', 'Supabase no está configurado.')
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        return error ? describeAuthError(error) : null
      },
      signUp: async (email, password) => {
        if (!supabase) return { issue: issue('other', 'Supabase no está configurado.'), needsConfirmation: false }
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: returnUrl() } })
        if (error) return { issue: describeAuthError(error), needsConfirmation: false }
        // confirmación activada + email ya existente: sin error, pero tampoco se envía ningún correo
        if (isExistingUserResponse(data.user)) return { issue: issue('exists'), needsConfirmation: false }
        return { issue: null, needsConfirmation: !data.session }
      },
      resendConfirmation: async (email) => {
        if (!supabase) return issue('other', 'Supabase no está configurado.')
        const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: returnUrl() } })
        return error ? describeAuthError(error) : null
      },
      signOut: async () => {
        await supabase?.auth.signOut()
      },
    }),
    [user, loading, notice],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth fuera de AuthProvider')
  return v
}

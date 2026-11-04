import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthState {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signUp: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(supabase !== null)

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

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      signIn: async (email, password) => {
        if (!supabase) return 'Supabase no está configurado.'
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        return error?.message ?? null
      },
      signUp: async (email, password) => {
        if (!supabase) return 'Supabase no está configurado.'
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) return error.message
        return data.session ? null : 'CONFIRM_EMAIL'
      },
      signOut: async () => {
        await supabase?.auth.signOut()
      },
    }),
    [user, loading],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth fuera de AuthProvider')
  return v
}

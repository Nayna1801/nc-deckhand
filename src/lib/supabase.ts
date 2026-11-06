import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchWithJwtRetry } from './retryFetch'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** null cuando no hay variables de entorno: la app funciona en modo invitado. */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey, { global: { fetch: (input, init) => fetchWithJwtRetry(input, init) } }) : null
export const hasSupabase = supabase !== null

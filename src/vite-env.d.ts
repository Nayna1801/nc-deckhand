/// <reference types="vite/client" />

/** Commit corto de la compilación ('dev' en desarrollo). */
declare const __APP_VERSION__: string
/** Fecha de la compilación (ISO). */
declare const __APP_BUILT__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

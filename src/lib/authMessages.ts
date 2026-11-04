/**
 * Mensajes de acceso en español. Los textos son SIEMPRE los nuestros: nunca se muestra tal cual lo que
 * llega de Supabase ni de la URL del correo (ni el texto en inglés ni nada que alguien pueda inyectar).
 */

export type AuthIssueKind = 'exists' | 'invalid' | 'unconfirmed' | 'rate' | 'weak' | 'disabled' | 'network' | 'link' | 'other'

export interface AuthIssue {
  kind: AuthIssueKind
  text: string
  /** Mensaje técnico original, solo para depurar (no se muestra como texto principal). */
  detail?: string
}

const TEXT: Record<AuthIssueKind, string> = {
  exists:
    'Ese email ya tiene una cuenta. Las cuentas se comparten con otras apps de este mismo proyecto, así que usa la misma contraseña que allí e inicia sesión.',
  invalid: 'Email o contraseña incorrectos.',
  unconfirmed: 'Todavía no has confirmado tu email. Revisa tu bandeja de entrada (y el spam) o reenvía el correo de confirmación.',
  rate: 'Demasiados intentos. Espera un par de minutos antes de volver a probar.',
  weak: 'La contraseña es demasiado débil: usa al menos 8 caracteres.',
  disabled: 'El registro no está disponible ahora mismo.',
  network: 'No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.',
  link: 'El enlace del correo ha caducado o ya se usó. Inicia sesión; si no puedes, reenvía el correo de confirmación.',
  other: 'No se pudo completar la operación. Inténtalo de nuevo.',
}

const BY_CODE: Record<string, AuthIssueKind> = {
  user_already_exists: 'exists',
  email_exists: 'exists',
  invalid_credentials: 'invalid',
  email_not_confirmed: 'unconfirmed',
  over_email_send_rate_limit: 'rate',
  over_request_rate_limit: 'rate',
  over_sms_send_rate_limit: 'rate',
  weak_password: 'weak',
  signup_disabled: 'disabled',
  email_provider_disabled: 'disabled',
  otp_expired: 'link',
}

const BY_MESSAGE: [RegExp, AuthIssueKind][] = [
  [/already registered|already been registered/i, 'exists'],
  [/invalid login credentials/i, 'invalid'],
  [/email not confirmed/i, 'unconfirmed'],
  [/rate limit|too many requests/i, 'rate'],
  [/password should be|weak password/i, 'weak'],
  [/failed to fetch|network|load failed/i, 'network'],
]

export const issue = (kind: AuthIssueKind, detail?: string): AuthIssue => ({ kind, text: TEXT[kind], ...(detail ? { detail } : {}) })

export function describeAuthError(e: { code?: string; message?: string; status?: number } | null | undefined): AuthIssue {
  if (!e) return issue('other')
  if (e.code && e.code in BY_CODE) return issue(BY_CODE[e.code], e.message)
  const hit = BY_MESSAGE.find(([re]) => re.test(e.message ?? ''))
  return issue(hit ? hit[1] : 'other', e.message)
}

/**
 * Con la confirmación de email activada, Supabase no devuelve error si el email ya existe (para no revelar
 * qué cuentas hay): devuelve un usuario "vacío" sin identidades. Hay que detectarlo, o se diría "revisa tu
 * correo" sin que se haya enviado ninguno.
 */
export function isExistingUserResponse(user: { identities?: unknown[] | null } | null | undefined): boolean {
  return Array.isArray(user?.identities) && user.identities.length === 0
}

const LINK_TYPES = ['signup', 'recovery', 'magiclink', 'invite', 'email_change'] as const
export type AuthLinkType = (typeof LINK_TYPES)[number]

/** Lee la vuelta desde el enlace de un correo de Supabase (llega en el fragmento de la URL). */
export function parseAuthLink(hash: string): { type: AuthLinkType | null; error: AuthIssue | null } {
  const raw = hash.replace(/^#/, '')
  // las rutas de la app (#/decks, #/?owned=…) no son enlaces de correo
  if (!raw || raw.startsWith('/')) return { type: null, error: null }
  const params = new URLSearchParams(raw)
  const t = params.get('type')
  const type = LINK_TYPES.find((x) => x === t) ?? null
  const failed = params.has('error') || params.has('error_code')
  return { type, error: failed ? issue('link') : null }
}

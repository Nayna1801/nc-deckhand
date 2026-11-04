import { describe, expect, it } from 'vitest'
import { describeAuthError, isExistingUserResponse, parseAuthLink } from './authMessages'

describe('describeAuthError', () => {
  it('usa el código del error cuando existe', () => {
    expect(describeAuthError({ code: 'user_already_exists', message: 'x' }).kind).toBe('exists')
    expect(describeAuthError({ code: 'email_exists' }).kind).toBe('exists')
    expect(describeAuthError({ code: 'invalid_credentials' }).kind).toBe('invalid')
    expect(describeAuthError({ code: 'email_not_confirmed' }).kind).toBe('unconfirmed')
    expect(describeAuthError({ code: 'over_email_send_rate_limit' }).kind).toBe('rate')
    expect(describeAuthError({ code: 'over_request_rate_limit' }).kind).toBe('rate')
    expect(describeAuthError({ code: 'weak_password' }).kind).toBe('weak')
    expect(describeAuthError({ code: 'signup_disabled' }).kind).toBe('disabled')
  })

  it('reconoce los mensajes de Supabase cuando no hay código', () => {
    expect(describeAuthError({ message: 'User already registered' }).kind).toBe('exists')
    expect(describeAuthError({ message: 'Invalid login credentials' }).kind).toBe('invalid')
    expect(describeAuthError({ message: 'Email not confirmed' }).kind).toBe('unconfirmed')
    expect(describeAuthError({ message: 'email rate limit exceeded' }).kind).toBe('rate')
    expect(describeAuthError({ message: 'Password should be at least 6 characters.' }).kind).toBe('weak')
    expect(describeAuthError({ message: 'Failed to fetch' }).kind).toBe('network')
  })

  it('el mensaje al usuario está en español, explica qué hacer y no es el texto en inglés', () => {
    const exists = describeAuthError({ message: 'User already registered' })
    expect(exists.text).toMatch(/ya tiene una cuenta/i)
    expect(exists.text).toMatch(/inicia(r)? sesión/i)
    expect(exists.text).not.toMatch(/already registered/i)
    expect(describeAuthError({ code: 'invalid_credentials' }).text).toMatch(/incorrectos/i)
    expect(describeAuthError({ code: 'email_not_confirmed' }).text).toMatch(/confirm/i)
  })

  it('un error desconocido no revienta y conserva el detalle técnico aparte', () => {
    const r = describeAuthError({ message: 'algo raro 123' })
    expect(r.kind).toBe('other')
    expect(r.detail).toBe('algo raro 123')
    expect(describeAuthError(null).kind).toBe('other')
    expect(describeAuthError(undefined).text.length).toBeGreaterThan(10)
  })
})

describe('isExistingUserResponse (alta sobre un email que ya existe)', () => {
  it('con confirmación activada Supabase no da error: devuelve un usuario sin identidades', () => {
    expect(isExistingUserResponse({ identities: [] })).toBe(true)
  })
  it('un alta nueva trae su identidad', () => {
    expect(isExistingUserResponse({ identities: [{ id: 'a' }] })).toBe(false)
  })
  it('sin datos no se asume nada', () => {
    expect(isExistingUserResponse(null)).toBe(false)
    expect(isExistingUserResponse(undefined)).toBe(false)
    expect(isExistingUserResponse({})).toBe(false)
    expect(isExistingUserResponse({ identities: null })).toBe(false)
  })
})

describe('parseAuthLink (vuelta desde el enlace del correo)', () => {
  it('detecta la confirmación de alta', () => {
    expect(parseAuthLink('#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer&type=signup')).toEqual({ type: 'signup', error: null })
  })

  it('detecta un enlace caducado o ya usado', () => {
    const r = parseAuthLink('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    expect(r.type).toBeNull()
    expect(r.error?.kind).toBe('link')
    expect(r.error?.text).toMatch(/caduc|ya se usó/i)
  })

  it('las rutas normales de la app no cuentan como enlace de correo', () => {
    expect(parseAuthLink('#/decks/123')).toEqual({ type: null, error: null })
    expect(parseAuthLink('')).toEqual({ type: null, error: null })
    expect(parseAuthLink('#/?owned=missing')).toEqual({ type: null, error: null })
  })

  it('solo devuelve tipos conocidos (nunca refleja texto arbitrario de la URL)', () => {
    expect(parseAuthLink('#type=<script>alert(1)</script>').type).toBeNull()
    expect(parseAuthLink('#type=recovery').type).toBe('recovery')
  })

  it('el texto del error es el nuestro, no el que venga en la URL', () => {
    const r = parseAuthLink('#error=access_denied&error_code=otp_expired&error_description=<img src=x onerror=alert(1)>')
    expect(r.error?.text).not.toMatch(/<img/)
  })
})

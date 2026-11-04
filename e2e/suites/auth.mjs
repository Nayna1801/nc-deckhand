import { chromium } from 'playwright'
import { BASE, SHOTS, SUPABASE_HOST } from '../config.mjs'

const shots = SHOTS
const HOST = SUPABASE_HOST
let failed = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++ }

const user = (email, identities = [{ id: 'i1', provider: 'email' }]) => ({
  id: '00000000-0000-4000-8000-0000000000aa', aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, identities, created_at: '2026-01-01T00:00:00Z',
})
const session = (email) => ({ access_token: 'x.y.z', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: user(email) })
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json' }

/** Supabase simulado: el comportamiento depende del email, como en un proyecto con otra app que comparte usuarios. */
async function newPage(browser, calls) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  await ctx.route(`${HOST}/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const method = req.method()
    const reply = (status, body) => route.fulfill({ status, headers: cors, body: JSON.stringify(body) })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    let body = {}
    try { body = JSON.parse(req.postData() || '{}') } catch { /* sin cuerpo */ }
    const email = body.email || ''
    if (url.pathname === '/auth/v1/signup') {
      calls.signup.push({ email, redirect: url.searchParams.get('redirect_to') })
      if (email === 'existe@x.com') return reply(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' })
      if (email === 'existe-confirm@x.com') return reply(200, user(email, [])) // confirmación activada: sin error y sin identidades
      return reply(200, user(email)) // alta nueva: usuario sin sesión (falta confirmar el correo)
    }
    if (url.pathname === '/auth/v1/resend') { calls.resend.push({ email, redirect: url.searchParams.get('redirect_to') }); return reply(200, {}) }
    if (url.pathname === '/auth/v1/token') {
      calls.login.push({ email, passwordLength: (body.password || '').length })
      if (email === 'sin-confirmar@x.com') return reply(400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' })
      if (email === 'corta@x.com' && body.password === 'abc12') return reply(200, session(email)) // contraseña de 5 caracteres de la otra app
      return reply(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
    }
    if (url.pathname === '/auth/v1/user') return reply(200, user('confirmado@x.com'))
    if (url.pathname.startsWith('/auth/v1/')) return reply(200, {})
    return reply(200, [])
  })
  const page = await ctx.newPage(); page.setDefaultTimeout(8000)
  return { page, ctx }
}

const browser = await chromium.launch()
const calls = { signup: [], resend: [], login: [] }
const errors = []
const { page: p } = await newPage(browser, calls)
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
// los 4xx son respuestas que este test provoca a propósito (email existente, credenciales erróneas): el navegador los registra siempre
p.on('console', (m) => { const t = m.text(); if (/content security policy/i.test(t) || (m.type() === 'error' && !/status of 4\d\d/.test(t))) errors.push('console: ' + t) })
const alertText = () => p.locator('.auth [role=alert]').innerText()
const toSignup = async () => { await p.getByRole('button', { name: /No tienes cuenta/ }).click() }
const fill = async (email, pw) => { await p.fill('input[type=email]', email); await p.fill('input[type=password]', pw) }

await p.goto(BASE + '#/login'); await p.waitForSelector('.auth form')

/* 1. alta con un email que ya existe (confirmación DESACTIVADA: Supabase responde con error) */
await toSignup(); await fill('existe@x.com', 'ContraseñaLarga1'); await p.getByRole('button', { name: 'Crear cuenta' }).click()
let t = await alertText()
ok(/ya tiene una cuenta/i.test(t) && /misma contraseña/i.test(t), 'email existente (error 422): explica que la cuenta es compartida y qué hacer')
ok(!/already registered/i.test(t), 'ya no se enseña el texto crudo en inglés')
await p.screenshot({ path: shots + '/a1-exists.png' })
await p.getByRole('button', { name: 'Ir a iniciar sesión' }).click()
ok((await p.locator('h1').innerText()).toLowerCase().includes('iniciar sesión') && (await p.inputValue('input[type=email]')) === 'existe@x.com', '"Ir a iniciar sesión" cambia de modo y conserva el email')

/* 2. alta con un email existente y confirmación ACTIVADA (sin error, pero sin correo) */
await toSignup(); await fill('existe-confirm@x.com', 'ContraseñaLarga1'); await p.getByRole('button', { name: 'Crear cuenta' }).click()
t = await alertText()
ok(/ya tiene una cuenta/i.test(t) && !/te hemos enviado/i.test(t), 'confirmación activada + email existente: NO dice "te hemos enviado un correo" (no se envía ninguno)')

/* 3. alta nueva: correo de confirmación */
await p.getByRole('button', { name: 'Ir a iniciar sesión' }).click(); await toSignup()
await fill('nuevo@x.com', 'ContraseñaLarga1'); await p.getByRole('button', { name: 'Crear cuenta' }).click()
await p.locator('.auth .notice').waitFor()
t = await p.locator('.auth .notice').innerText()
ok(/te hemos enviado un correo a nuevo@x\.com/i.test(t) && /spam/i.test(t), 'alta nueva: avisa del correo enviado y del spam')
const last = calls.signup.at(-1)
ok(last.redirect === BASE, `el enlace del correo volverá a ESTA web (redirect_to = ${last.redirect})`)
const resendBtn = p.getByRole('button', { name: /Reenviar correo/ })
ok(await resendBtn.isDisabled() && /\(\d+ s\)/i.test(await resendBtn.innerText()), 'el reenvío tiene cuenta atrás (evita enviar correos en bucle)')
await p.screenshot({ path: shots + '/a2-confirm.png' })

/* 4. inicio de sesión con el correo sin confirmar -> reenviar */
await p.reload(); await p.waitForSelector('.auth form')
await fill('sin-confirmar@x.com', 'ContraseñaLarga1'); await p.getByRole('button', { name: 'Entrar' }).click()
t = await alertText()
ok(/todavía no has confirmado/i.test(t) && !/not confirmed/i.test(t), 'correo sin confirmar: mensaje claro en español')
await p.getByRole('button', { name: 'Reenviar correo de confirmación' }).click()
await p.locator('.auth .notice').waitFor()
ok(calls.resend.length === 1 && calls.resend[0].email === 'sin-confirmar@x.com' && calls.resend[0].redirect === BASE, 'reenviar llama a Supabase con el email y la web de vuelta correctos')
ok(/reenviado/i.test(await p.locator('.auth .notice').innerText()) && (await p.getByRole('button', { name: /Reenviar correo/ }).isDisabled()), 'confirma el reenvío y bloquea el botón unos segundos')

/* 5. contraseña incorrecta */
await p.reload(); await p.waitForSelector('.auth form')
await fill('nadie@x.com', 'otra-cosa-1'); await p.getByRole('button', { name: 'Entrar' }).click()
ok(/incorrectos/i.test(await alertText()), 'credenciales erróneas: "Email o contraseña incorrectos"')
ok((await p.locator('.auth [role=alert]').count()) === 1, 'el mensaje se anuncia a lectores de pantalla (role=alert)')

/* 6. contraseña corta de otra app: no la bloquea el navegador */
await p.reload(); await p.waitForSelector('.auth form')
ok((await p.locator('input[type=password]').getAttribute('minlength')) === null, 'al iniciar sesión NO se exige longitud mínima (la cuenta puede venir de otra app)')
await toSignup()
ok((await p.locator('input[type=password]').getAttribute('minlength')) === '8', 'al crear cuenta SÍ se exigen 8 caracteres')
await p.getByRole('button', { name: /Ya tienes cuenta/ }).click()
await fill('corta@x.com', 'abc12'); await p.getByRole('button', { name: 'Entrar' }).click()
await p.waitForURL(/#\/collection/)
ok(calls.login.at(-1).passwordLength === 5, 'una contraseña de 5 caracteres de la otra app permite entrar (antes el formulario ni se enviaba)')

/* 7. vuelta desde el enlace del correo (válido) */
{
  const { page: q, ctx: c } = await newPage(browser, { signup: [], resend: [], login: [] })
  q.setDefaultTimeout(8000)
  const qerrs = []; q.on('pageerror', (e) => qerrs.push(e.message))
  await q.goto(BASE + '#access_token=AAA.BBB.CCC&refresh_token=rrr&expires_in=3600&token_type=bearer&type=signup')
  await q.locator('.banner-ok').waitFor()
  ok(/email confirmado/i.test(await q.locator('.banner-ok').innerText()), 'enlace válido: aviso "Email confirmado: tu cuenta ya está activa"')
  ok((await q.locator('.topbar .who').innerText()).includes('confirmado@x.com'), 'y la sesión queda iniciada (el router con # no rompe la vuelta)')
  ok(!(await q.evaluate(() => location.hash)).includes('access_token'), 'los tokens desaparecen de la barra de direcciones')
  await q.screenshot({ path: shots + '/a3-confirmed.png' })
  await q.getByRole('button', { name: 'Cerrar' }).first().click()
  ok((await q.locator('.banner-ok').count()) === 0, 'el aviso se puede cerrar')
  ok(qerrs.length === 0, 'sin errores de página en la vuelta')
  await c.close()
}

/* 8. enlace caducado y 9. intento de inyección por la URL */
{
  const { page: q, ctx: c } = await newPage(browser, { signup: [], resend: [], login: [] })
  await q.goto(BASE + '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
  await q.locator('.banner').waitFor()
  ok(/caducado|ya se usó/i.test(await q.locator('.banner').innerText()) && (await q.locator('.topbar .who').innerText()).toLowerCase().includes('iniciar sesión'), 'enlace caducado: aviso claro y sin sesión')
  await c.close()
  const { page: z, ctx: c2 } = await newPage(browser, { signup: [], resend: [], login: [] })
  await z.goto(BASE + '#error=access_denied&error_code=otp_expired&error_description=%3Cimg+src%3Dx+onerror%3Dwindow.__pwn%3D1%3E')
  await z.locator('.banner').waitFor(); await z.waitForTimeout(300)
  ok((await z.evaluate(() => window.__pwn)) === undefined && (await z.locator('.banner img').count()) === 0, 'texto malicioso en la URL del correo: no se refleja ni se ejecuta')
  await c2.close()
}

console.log(errors.length ? 'ERRORES DE CONSOLA/PÁGINA:\n' + [...new Set(errors)].join('\n') : 'sin errores de consola ni violaciones de CSP')
if (errors.length) failed++
console.log(failed ? `\n${failed} FALLOS` : '\nTODO OK')
await browser.close(); process.exit(failed ? 1 : 0)

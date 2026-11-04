import { SUPABASE_HOST, SUPABASE_REF } from '../config.mjs'

const HOST = SUPABASE_HOST

/**
 * Supabase simulado MÁS FIEL: estado persistente entre recargas, latencia configurable por petición y las
 * mismas restricciones que schema.sql (quantity/foil/promo 0..999, condición válida, longitud del id).
 */
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json' }

export async function newBackend(browser, { rows = {}, latency = [120, 260], getLatency = null, viewport = { width: 1400, height: 1000 }, hasTouch = false, isMobile = false } = {}) {
  const store = { collection: new Map(Object.entries(rows).map(([id, r]) => [id, { card_id: id, quantity: 0, qty_foil: 0, qty_promo: 0, condition: 'mint', ...r }])), decks: new Map(), wishlist: new Map(), log: [], inflight: 0, violations: [] }
  const ctx = await browser.newContext({ viewport, hasTouch, isMobile })
  const exp = Math.floor(Date.now() / 1000) + 3600
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'test@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
  const session = { access_token: 'x.y.z', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user }
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${SUPABASE_REF}-auth-token`, JSON.stringify(session)])
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const rnd = ([a, b]) => a + Math.random() * (b - a)

  await ctx.route(`${HOST}/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const method = req.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const reply = (status, body) => route.fulfill({ status, headers: cors, body: body === '' ? '' : JSON.stringify(body) })
    if (url.pathname.startsWith('/auth/v1')) return reply(200, url.pathname.endsWith('/user') ? user : session)
    const table = url.pathname.split('/').pop()
    const map = table === 'tcg_collection' ? store.collection : table === 'tcg_decks' ? store.decks : table === 'tcg_wishlist' ? store.wishlist : null
    if (!map) return reply(404, {})
    const key = table === 'tcg_decks' ? 'id' : 'card_id'
    store.inflight++
    try {
      await wait(method === 'GET' && getLatency ? getLatency : rnd(latency))
      if (method === 'GET') return reply(200, [...map.values()])
      if (method === 'POST' || method === 'PATCH') {
        const body = JSON.parse(req.postData() || '[]'); const list = Array.isArray(body) ? body : [body]
        for (const r of list) {
          if (table === 'tcg_collection') {
            const bad = ['quantity', 'qty_foil', 'qty_promo'].find((k) => k in r && !(Number.isInteger(r[k]) && r[k] >= 0 && r[k] <= 999))
            if (bad || ('condition' in r && !['mint', 'played', 'damaged'].includes(r.condition)) || String(r.card_id).length > 100) {
              store.violations.push(JSON.stringify(r))
              return reply(400, { code: '23514', message: 'new row violates check constraint' })
            }
          }
          map.set(r[key], { ...(map.get(r[key]) ?? {}), ...r })
          store.log.push({ op: 'upsert', table, row: { ...r } })
        }
        return reply(201, [])
      }
      if (method === 'DELETE') {
        for (const [k, v] of url.searchParams) {
          if (k !== key) continue
          if (v.startsWith('eq.')) { map.delete(v.slice(3)); store.log.push({ op: 'delete', table, id: v.slice(3) }) }
          if (v.startsWith('in.(')) v.slice(4, -1).split(',').forEach((x) => map.delete(x.replace(/"/g, '')))
        }
        return reply(204, '')
      }
      return reply(200, [])
    } finally {
      store.inflight--
    }
  })
  const page = await ctx.newPage(); page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { const t = m.text(); if (/content security policy/i.test(t) || (m.type() === 'error' && !/status of 4\d\d/.test(t))) errors.push('console: ' + t) })
  // con peticiones en cola hay huecos entre una y la siguiente: se espera a un silencio sostenido, no a un instante sin tráfico
  const settle = async () => { let quiet = 0; while (quiet < 500) { await page.waitForTimeout(50); quiet = store.inflight > 0 ? 0 : quiet + 50 } }
  return { ctx, page, store, errors, settle }
}

import fs from 'node:fs'
import { SUPABASE_HOST, SUPABASE_REF } from '../config.mjs'
const HOST = SUPABASE_HOST
/** Supabase simulado: auth con sesión válida + tablas tcg_* en memoria. */
export async function newSession(browser, opts) {
  const { legacy } = opts
  const store = { collection: new Map(), decks: new Map(), wishlist: new Map(), writes: [] }
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })
  const exp = Math.floor(Date.now() / 1000) + 3600
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'test@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
  const session = { access_token: 'x.y.z', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user }
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${SUPABASE_REF}-auth-token`, JSON.stringify(session)])
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json' }
  await ctx.route(`${HOST}/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const method = req.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (url.pathname.startsWith('/auth/v1')) return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(url.pathname.endsWith('/user') ? user : session) })
    const table = url.pathname.split('/').pop()
    if (table === 'tcg_wishlist' && opts.noWishlist) return route.fulfill({ status: 404, headers: cors, body: JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.tcg_wishlist' in the schema cache" }) })
    const map = table === 'tcg_collection' ? store.collection : table === 'tcg_decks' ? store.decks : table === 'tcg_wishlist' ? store.wishlist : null
    if (!map) return route.fulfill({ status: 404, headers: cors, body: '{}' })
    const key = table === 'tcg_decks' ? 'id' : 'card_id'
    if (method === 'GET') {
      if (table === 'tcg_collection' && legacy && (url.searchParams.get('select') || '').includes('qty_foil')) {
        return route.fulfill({ status: 400, headers: cors, body: JSON.stringify({ code: '42703', message: 'column tcg_collection.qty_foil does not exist' }) })
      }
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify([...map.values()]) })
    }
    if (method === 'POST' || method === 'PATCH') {
      const body = JSON.parse(req.postData() || '[]'); const rows = Array.isArray(body) ? body : [body]
      store.writes.push({ table, rows })
      rows.forEach((r) => map.set(r[key], { ...(map.get(r[key]) ?? {}), ...r }))
      return route.fulfill({ status: 201, headers: cors, body: '[]' })
    }
    if (method === 'DELETE') {
      for (const [k, v] of url.searchParams) {
        if (k !== key) continue
        if (v.startsWith('eq.')) map.delete(v.slice(3))
        if (v.startsWith('in.(')) v.slice(4, -1).split(',').forEach((x) => map.delete(x.replace(/"/g, '')))
      }
      return route.fulfill({ status: 204, headers: cors, body: '' })
    }
    return route.fulfill({ status: 200, headers: cors, body: '[]' })
  })
  const page = await ctx.newPage(); page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  return { ctx, page, store, errors }
}


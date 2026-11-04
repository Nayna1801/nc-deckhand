import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { catalog, setLabel } from '../lib/catalog'
import { MAX_IMPORT_CHARS, parseCollectionText, serializeCollection } from '../lib/deckText'
import { bulkList, bulkToCsv, CONDITIONS, CONDITION_LABEL, splitPlayset, totalOf, type Condition } from '../lib/inventory'
import { buildWants, buildWishlist, wantsToCsv, wantsToJson, wishlistToCsv, wishlistToJson } from '../lib/wishlist'
import { CardModal, downloadText, Stepper, useCardModal, usePreview } from '../components/cardUi'
import { InventoryEditor } from '../components/InventoryEditor'
import { useData } from '../state/DataContext'

type Tab = 'wishlist' | 'wants' | 'bulk'

export function CollectionPage() {
  const { loggedIn, collection, inventory, inventoryV2, decks, setInventory, importCollection, wishlist: wantsMap, wishlistAvailable, setWanted } = useData()
  const modal = useCardModal()
  const { bind, layer } = usePreview()
  const [text, setText] = useState('')
  const [issues, setIssues] = useState<string[]>([])
  const [mode, setMode] = useState<'replace' | 'add'>('add')
  const [tab, setTab] = useState<Tab>('wishlist')

  const stats = useMemo(() => {
    const unique = catalog.cards.filter((c) => collection[c.id] > 0).length
    const total = Object.values(collection).reduce((a, b) => a + b, 0)
    const playset = catalog.cards.reduce((a, c) => a + Math.min(3, collection[c.id] ?? 0), 0)
    const bulk = Object.values(collection).reduce((a, n) => a + splitPlayset(n).bulk, 0)
    const foil = Object.values(inventory).reduce((a, e) => a + e.foil, 0)
    const bySet = [...new Set(catalog.cards.map((c) => c.setCode))].map((code) => {
      const inSet = catalog.cards.filter((c) => c.setCode === code)
      return { code, label: setLabel(inSet[0]), have: inSet.filter((c) => collection[c.id] > 0).length, of: inSet.length }
    })
    return { unique, total, playset, bulk, foil, bySet }
  }, [collection, inventory])

  const missingCount = catalog.cards.length - stats.unique
  const wishlist = useMemo(() => buildWishlist(decks, collection, catalog), [decks, collection])
  const wants = useMemo(() => buildWants(wantsMap, collection, catalog), [wantsMap, collection])
  const bulk = useMemo(() => bulkList(inventory).sort((a, b) => (catalog.byId[a.cardId]?.displayName ?? '').localeCompare(catalog.byId[b.cardId]?.displayName ?? '')), [inventory])
  const bulkCopies = bulk.reduce((a, r) => a + r.bulk, 0)

  if (!loggedIn) {
    return (
      <section>
        <header className="page-head"><h1>Colección</h1></header>
        <p className="empty">Para llevar la cuenta de tus cartas necesitas una cuenta. <Link to="/login">Iniciar sesión / crear cuenta</Link></p>
      </section>
    )
  }

  const doImport = async () => {
    const r = parseCollectionText(text, catalog)
    setIssues(r.issues.map((i) => (i.line ? `Línea ${i.line}: ${i.reason}` : i.reason)))
    if (Object.keys(r.collection).length === 0) return
    if (mode === 'replace' && !window.confirm('Esto reemplaza toda tu colección actual (incluidas versiones Foil/Promo). ¿Continuar?')) return
    await importCollection(r.collection, mode)
    if (r.issues.length === 0) setText('')
  }

  const names = (id: string) => ({ code: catalog.byId[id]?.importId ?? '', name: catalog.byId[id]?.displayName ?? id, set: catalog.byId[id]?.setName ?? '' })
  const line = (n: number, id: string) => `${n}x ${catalog.byId[id]?.importId ?? ''} ${catalog.byId[id]?.displayName ?? id}`.replace(/\s+/g, ' ')

  return (
    <section>
      <header className="page-head"><h1>Colección</h1></header>

      <div className="stats-row">
        <div className="stat"><strong>{stats.unique}<small>/{catalog.cards.length}</small></strong><span>cartas distintas</span></div>
        <Link className="stat stat-link" to="/?owned=missing"><strong>{missingCount}</strong><span>me faltan · ver en Cartas →</span></Link>
        <div className="stat"><strong>{stats.total}</strong><span>copias en total{stats.foil > 0 && ` · ${stats.foil} foil`}</span></div>
        <div className="stat"><strong>{Math.round((stats.playset / (catalog.cards.length * 3)) * 100)}%</strong><span>de playsets (×3)</span></div>
        <div className="stat"><strong>{stats.bulk}</strong><span>copias en bulk</span></div>
        {stats.bySet.map((s) => (
          <div className="stat" key={s.code}>
            <strong>{s.have}<small>/{s.of}</small></strong><span>{s.label}</span>
            <progress value={s.have} max={s.of} />
          </div>
        ))}
      </div>

      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === 'wishlist'} className={tab === 'wishlist' ? 'on' : ''} onClick={() => setTab('wishlist')}>Para mis mazos ({wishlist.length})</button>
        <button role="tab" aria-selected={tab === 'wants'} className={tab === 'wants' ? 'on' : ''} onClick={() => setTab('wants')}>♥ Mis deseos ({wants.length})</button>
        <button role="tab" aria-selected={tab === 'bulk'} className={tab === 'bulk' ? 'on' : ''} onClick={() => setTab('bulk')}>Bulk / intercambio ({bulkCopies})</button>
      </div>

      {tab === 'wants' && (
        <div className="panel">
          <p className="muted small">Cartas que quieres conseguir, estén o no en un mazo. Márcalas con el ♥ en la página de Cartas o desde el detalle de cada carta.</p>
          {!wishlistAvailable && <p className="notice small">Para usar la lista de deseos, vuelve a ejecutar <code>supabase/schema.sql</code> en Supabase (es seguro repetirlo).</p>}
          {wishlistAvailable && wants.length === 0 && <p>Todavía no has marcado ninguna carta. Pulsa el ♥ de una carta para añadirla.</p>}
          <ul className="plain">
            {wants.map((r) => (
              <li key={r.cardId} className="deck-row">
                <button className="link-btn" onClick={() => modal.open(r.cardId)} {...bind(catalog.byId[r.cardId])}>{r.name}</button>
                <span className="muted small">tienes {r.owned}</span>
                <Stepper value={r.wanted} min={1} max={99} onChange={(v) => void setWanted(r.cardId, v)} />
                <button className="btn ghost sm" onClick={() => void setWanted(r.cardId, 0)} aria-label={`Quitar ${r.name} de deseos`}>Quitar</button>
              </li>
            ))}
          </ul>
          {wants.length > 0 && (
            <div className="row wrap">
              <button className="btn primary" onClick={() => downloadText('deseos.csv', wantsToCsv(wants), 'text/csv')}>Exportar CSV</button>
              <button className="btn" onClick={() => downloadText('deseos.json', wantsToJson(wants), 'application/json')}>Exportar JSON</button>
              <button className="btn" onClick={() => downloadText('deseos.txt', wants.map((r) => line(r.wanted, r.cardId)).join('\n'))}>Exportar texto</button>
            </div>
          )}
        </div>
      )}

      {tab === 'wishlist' && (
        <div className="panel">
          <p className="muted small">Cruce de tus mazos guardados con tu inventario real: lo que te falta para tener todos montados a la vez (suma de lo que pide cada mazo).</p>
          {wishlist.length === 0 && <p>{decks.length === 0 ? 'Aún no tienes mazos guardados.' : 'No te falta nada para tus mazos.'}</p>}
          <ul className="plain">
            {wishlist.map((r) => (
              <li key={r.cardId} className="deck-row">
                <button className="link-btn" onClick={() => modal.open(r.cardId)} {...bind(catalog.byId[r.cardId])}>{r.name}</button>
                <span className="pill bad">faltan {r.missing}</span>
                <span className="muted small" title={r.decks.join(', ')}>tienes {r.owned} / pides {r.needed}</span>
              </li>
            ))}
          </ul>
          {wishlist.length > 0 && (
            <div className="row wrap">
              <button className="btn primary" onClick={() => downloadText('lista-de-compra.csv', wishlistToCsv(wishlist), 'text/csv')}>Exportar CSV</button>
              <button className="btn" onClick={() => downloadText('lista-de-compra.json', wishlistToJson(wishlist), 'application/json')}>Exportar JSON</button>
              <button className="btn" onClick={() => downloadText('lista-de-compra.txt', wishlist.map((r) => line(r.missing, r.cardId)).join('\n'))}>Exportar texto</button>
            </div>
          )}
        </div>
      )}

      {tab === 'bulk' && (
        <div className="panel">
          <p className="muted small">Un playset son 3 copias de una carta (lo máximo que se puede llevar en un mazo). De la 4ª copia en adelante pasan aquí automáticamente. Indica el estado de las que quieras cambiar o vender.</p>
          {bulk.length === 0 && <p>Todavía no tienes copias sobrantes. Con 4 o más copias de una carta aparecerán aquí.</p>}
          <ul className="plain">
            {bulk.map((r) => (
              <li key={r.cardId} className="deck-row">
                <button className="link-btn" onClick={() => modal.open(r.cardId)} {...bind(catalog.byId[r.cardId])}>{catalog.byId[r.cardId]?.displayName}</button>
                <span className="pill warn">bulk ×{r.bulk}</span>
                <span className="muted small">de {totalOf(inventory[r.cardId])}</span>
                {inventoryV2 && (
                  <select className="input" aria-label="Estado" value={r.condition} onChange={(e) => void setInventory(r.cardId, { condition: e.target.value as Condition })}>
                    {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
                  </select>
                )}
              </li>
            ))}
          </ul>
          {bulk.length > 0 && (
            <div className="row wrap">
              <button className="btn primary" onClick={() => downloadText('bulk.csv', bulkToCsv(bulk, names), 'text/csv')}>Exportar bulk CSV</button>
              <button className="btn" onClick={() => downloadText('bulk.txt', bulk.map((r) => `${line(r.bulk, r.cardId)} (${CONDITION_LABEL[r.condition]})`).join('\n'))}>Exportar texto</button>
            </div>
          )}
        </div>
      )}

      <h2>Importar / exportar</h2>
      <div className="panel">
        <textarea className="input mono" rows={8} maxLength={MAX_IMPORT_CHARS} value={text} onChange={(e) => setText(e.target.value)} placeholder={'1x 012 Goro Takemura: Hands Unclean\n3x 089 Saul Bright: Stormrider'} />
        {issues.length > 0 && <ul className="errors">{issues.map((r) => <li key={r}>{r}</li>)}</ul>}
        <div className="row wrap">
          <div className="seg">
            <button className={mode === 'add' ? 'on' : ''} onClick={() => setMode('add')}>Sumar a lo que tengo</button>
            <button className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')}>Reemplazar todo</button>
          </div>
          <button className="btn primary" onClick={() => void doImport()} disabled={!text.trim()}>Importar</button>
          <button className="btn" onClick={() => downloadText('coleccion.txt', serializeCollection(collection, catalog))} disabled={stats.total === 0}>Exportar colección</button>
        </div>
      </div>

      {layer}
      <CardModal card={modal.card} onClose={modal.close}>{modal.card && <InventoryEditor cardId={modal.card.id} />}</CardModal>
    </section>
  )
}

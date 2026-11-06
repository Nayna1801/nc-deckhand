import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { catalog, setLabel } from '../lib/catalog'
import { MAX_IMPORT_CHARS, parseCollectionText, serializeCollection } from '../lib/deckText'
import { variantsOf, TOTAL_VARIANTS } from '../lib/variants'
import { bulkList, bulkToCsv, CONDITION_LABEL, clampPick, ownedKinds, pickedTotal, playsetSize, splitPlayset, type PickedCopies, type Withdrawal } from '../lib/inventory'
import { buildWants, buildWishlist, wantsToCsv, wantsToJson, wishlistToCsv, wishlistToJson } from '../lib/wishlist'
import { CardModal, downloadText, Stepper, useCardModal, usePreview } from '../components/cardUi'
import { BulkRow } from '../components/BulkRow'
import { InventoryEditor } from '../components/InventoryEditor'
import { useData } from '../state/DataContext'

type Tab = 'wishlist' | 'wants' | 'bulk'

export function CollectionPage() {
  const { loggedIn, collection, inventory, inventoryV2, decks, setInventory, withdrawBulk, importCollection, wishlist: wantsMap, wishlistAvailable, setWanted, ready } = useData()
  const modal = useCardModal()
  const { bind, layer } = usePreview()
  const [text, setText] = useState('')
  const [issues, setIssues] = useState<string[]>([])
  const [mode, setMode] = useState<'replace' | 'add'>('add')
  const [tab, setTab] = useState<Tab>('wishlist')
  // retirada de bulk: cartas marcadas y cuántas copias se retiran de cada una (por defecto, todo su bulk)
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [outQty, setOutQty] = useState<Record<string, number>>({})
  // cartas con varias versiones o artes: qué copias concretas se retiran (se elige en el desplegable de la fila)
  const [picks, setPicks] = useState<Record<string, PickedCopies>>({})
  const [bulkNote, setBulkNote] = useState('')

  const stats = useMemo(() => {
    const unique = catalog.cards.filter((c) => collection[c.id] > 0).length
    const total = Object.values(collection).reduce((a, b) => a + b, 0)
    // playset: 3 copias por carta, 1 por Legend (solo se lleva una vez por mazo)
    const playsetTotal = catalog.cards.reduce((a, c) => a + playsetSize(c), 0)
    const playset = catalog.cards.reduce((a, c) => a + Math.min(playsetSize(c), collection[c.id] ?? 0), 0)
    const bulk = Object.entries(collection).reduce((a, [id, n]) => a + splitPlayset(n, playsetSize(catalog.byId[id])).bulk, 0)
    const foil = Object.values(inventory).reduce((a, e) => a + e.foil, 0)
    // artes alternativos y promos con diseño propio que tienes (cada diseño cuenta una vez, tengas las copias que tengas)
    const artsOwned = catalog.cards.reduce((a, c) => a + variantsOf(c).filter((v) => (inventory[c.id]?.arts[v.key] ?? 0) > 0).length, 0)
    const artsCopies = Object.values(inventory).reduce((a, e) => a + Object.values(e.arts).reduce((x, n) => x + n, 0), 0)
    const bySet = [...new Set(catalog.cards.map((c) => c.setCode))].map((code) => {
      const inSet = catalog.cards.filter((c) => c.setCode === code)
      return { code, label: setLabel(inSet[0]), have: inSet.filter((c) => collection[c.id] > 0).length, of: inSet.length }
    })
    return { unique, total, playset, playsetTotal, bulk, foil, artsOwned, artsCopies, bySet }
  }, [collection, inventory])

  const missingCount = catalog.cards.length - stats.unique
  const wishlist = useMemo(() => buildWishlist(decks, collection, catalog), [decks, collection])
  const wants = useMemo(() => buildWants(wantsMap, collection, catalog), [wantsMap, collection])
  const bulk = useMemo(() => bulkList(inventory, (id) => playsetSize(catalog.byId[id])).sort((a, b) => (catalog.byId[a.cardId]?.displayName ?? '').localeCompare(catalog.byId[b.cardId]?.displayName ?? '')), [inventory])
  const bulkCopies = bulk.reduce((a, r) => a + r.bulk, 0)
  // si el bulk de una carta baja (o desaparece) la cantidad a retirar se ajusta sola
  const qtyOf = (r: { cardId: string; bulk: number }) => Math.max(1, Math.min(outQty[r.cardId] ?? r.bulk, r.bulk))
  const picked = bulk.filter((r) => checked.has(r.cardId))
  const isMulti = (cardId: string) => ownedKinds(inventory[cardId]).length > 1
  const pickOf = (r: { cardId: string; bulk: number }) => clampPick(picks[r.cardId], inventory[r.cardId], r.bulk)
  /** Qué se retira de una fila: lo elegido (varias versiones/artes) o la cantidad por orden (un solo tipo); null = nada elegido aún. */
  const itemOf = (r: { cardId: string; bulk: number }): Withdrawal | null => {
    if (!isMulti(r.cardId)) return { cardId: r.cardId, qty: qtyOf(r) }
    const pick = pickOf(r)
    return pickedTotal(pick) > 0 ? { cardId: r.cardId, pick } : null
  }
  const copiesOf = (r: { cardId: string; bulk: number }) => (isMulti(r.cardId) ? pickedTotal(pickOf(r)) : qtyOf(r))
  const pickedCopies = picked.reduce((a, r) => a + copiesOf(r), 0)

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
    if (mode === 'replace' && !window.confirm('Esto reemplaza toda tu colección actual (incluidas versiones Foil/Promo y artes alternativos). ¿Continuar?')) return
    await importCollection(r.collection, mode)
    if (r.issues.length === 0) setText('')
  }

  const toggleChecked = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const forget = (rows: typeof bulk) => {
    setChecked((prev) => new Set([...prev].filter((id) => !rows.some((r) => r.cardId === id))))
    setPicks((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !rows.some((r) => r.cardId === id))))
  }

  /** Retirada de varias cartas: lo elegido en las que tienen versiones y la cantidad en las demás. */
  const withdraw = async (rows: typeof bulk, what: string) => {
    const items = rows.map((r) => ({ row: r, item: itemOf(r) }))
    const todo = items.flatMap((x) => (x.item ? [x.item] : []))
    const skipped = items.filter((x) => !x.item).map((x) => catalog.byId[x.row.cardId]?.displayName ?? x.row.cardId)
    const copies = rows.reduce((a, r) => a + copiesOf(r), 0)
    if (copies === 0) {
      setBulkNote(skipped.length ? `Abre «Elegir qué retirar» en ${skipped.join(', ')} y marca qué copias quieres retirar.` : '')
      return
    }
    setBulkNote('')
    const note = skipped.length ? `\nSe omiten porque no has elegido qué copias: ${skipped.join(', ')}.` : ''
    if (!window.confirm(`Se descontarán ${copies} ${copies === 1 ? 'copia' : 'copias'} de tu colección (${what}).${note}\n¿Continuar?`)) return
    await withdrawBulk(todo)
    forget(rows.filter((r) => itemOf(r)))
  }

  /** Retirada directa de lo elegido en el desplegable de una carta: elegir exactamente qué copias ya es la confirmación. */
  const withdrawPicked = async (cardId: string, pick: PickedCopies) => {
    if (pickedTotal(pick) === 0) return
    await withdrawBulk([{ cardId, pick }])
    setPicks((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== cardId)))
    setChecked((prev) => new Set([...prev].filter((id) => id !== cardId)))
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
        <div className="stat"><strong>{Math.round((stats.playset / stats.playsetTotal) * 100)}%</strong><span>de playsets completos</span></div>
        <div className="stat"><strong>{stats.bulk}</strong><span>copias en bulk</span></div>
        <Link className="stat stat-link" to="/?arts=1&owned=owned">
          <strong>{stats.artsOwned}<small>/{TOTAL_VARIANTS}</small></strong>
          <span>artes alternativos y promos{stats.artsCopies > 0 ? ` · ${stats.artsCopies} ${stats.artsCopies === 1 ? 'copia' : 'copias'}` : ''} · ver →</span>
          <progress value={stats.artsOwned} max={TOTAL_VARIANTS} />
        </Link>
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
                <Stepper value={r.wanted} min={1} max={99} disabled={!ready} onChange={(v) => void setWanted(r.cardId, v)} />
                <button className="btn ghost sm" disabled={!ready} onClick={() => void setWanted(r.cardId, 0)} aria-label={`Quitar ${r.name} de deseos`}>Quitar</button>
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
          <p className="muted small">Un playset son 3 copias de una carta (1 en las Legends, que solo se llevan una vez por mazo). Lo que pasa de ahí viene aquí automáticamente. Indica el estado de las que quieras cambiar o vender.</p>
          {bulk.length === 0 && <p>Todavía no tienes copias sobrantes. Con 4 o más copias de una carta aparecerán aquí.</p>}
          {bulk.length > 0 && (
            <div className="row wrap bulk-bar">
              <button className="btn sm" onClick={() => setChecked(picked.length === bulk.length ? new Set() : new Set(bulk.map((r) => r.cardId)))}>
                {picked.length === bulk.length ? 'Quitar selección' : 'Seleccionar todo'}
              </button>
              <button className="btn primary sm" disabled={!ready || picked.length === 0} onClick={() => void withdraw(picked, `${picked.length} ${picked.length === 1 ? 'carta' : 'cartas'}`)}>
                Retirar seleccionadas{picked.length > 0 ? ` (${pickedCopies})` : ''}
              </button>
              <span className="muted small">Para cuando vendes, regalas o cambias copias: se descuentan de tu colección de una vez.</span>
            </div>
          )}
          {bulkNote && <p className="notice small" role="status">{bulkNote}</p>}
          <ul className="plain">
            {bulk.map((r) => (
              <BulkRow
                key={r.cardId}
                cardId={r.cardId}
                bulk={r.bulk}
                condition={r.condition}
                entry={inventory[r.cardId]}
                checked={checked.has(r.cardId)}
                onToggle={() => toggleChecked(r.cardId)}
                qty={qtyOf(r)}
                onQty={(v) => setOutQty((q) => ({ ...q, [r.cardId]: v }))}
                pick={picks[r.cardId]}
                onPick={(p) => setPicks((prev) => ({ ...prev, [r.cardId]: p }))}
                onWithdrawQty={() => void withdraw([r], catalog.byId[r.cardId]?.displayName ?? r.cardId)}
                onWithdrawPick={(p) => void withdrawPicked(r.cardId, p)}
                onOpenCard={() => modal.open(r.cardId)}
                preview={bind(catalog.byId[r.cardId])}
                ready={ready}
                showCondition={inventoryV2}
                onCondition={(c) => void setInventory(r.cardId, { condition: c })}
              />
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

import { useState } from 'react'
import { catalog } from '../lib/catalog'
import { availableVersions, CONDITIONS, CONDITION_LABEL, EMPTY_ENTRY, playsetSize, splitPlayset, totalOf, type Condition } from '../lib/inventory'
import { thumbOf } from '../lib/images'
import { variantsOf } from '../lib/variants'
import { useData } from '../state/DataContext'
import { Stepper } from './cardUi'
import { WishEditor } from './Wish'

const copies = (n: number) => (n === 1 ? '1 copia' : `${n} copias`)

/** Copias por versión, estado de conservación, playset / bulk y lista de deseos. */
export function InventoryEditor({ cardId }: { cardId: string }) {
  const { inventory, inventoryV2, artsAvailable, setInventory, setArtCopies, ready } = useData()
  const [showAll, setShowAll] = useState(false)
  const card = catalog.byId[cardId]
  const e = inventory[cardId] ?? EMPTY_ENTRY
  const total = totalOf(e)
  const size = playsetSize(card)
  const { active, bulk } = splitPlayset(total, size)
  const isLegend = card?.type === 'Legend'

  // Solo se ofrecen las versiones que existen para esta carta (o las que ya tienes anotadas)
  const avail = card ? availableVersions(card) : { foil: false, promo: false }
  // «Promo / Full Art» ya no se ofrece: cada arte alternativo o promo tiene su contador. Solo se ve si ya había
  // copias anotadas ahí (sin arte concreto), para poder repartirlas entre los artes.
  const showLegacyPromo = inventoryV2 && e.promo > 0
  const showFoil = inventoryV2 && (showAll || avail.foil || e.foil > 0)
  const hiddenVersions = inventoryV2 && !showFoil
  const variants = card ? variantsOf(card) : []
  const movePromoTo = (key: string) => void setInventory(cardId, { promo: e.promo - 1, arts: { ...e.arts, [key]: (e.arts[key] ?? 0) + 1 } })

  return (
    <>
      <div className="panel inventory">
        <div className="row between"><strong title="Cuenta la carta con su diseño base, sea de la edición Beta o de la Retail">Normal</strong><Stepper value={e.normal} disabled={!ready} onChange={(v) => void setInventory(cardId, { normal: v })} /></div>
        {showLegacyPromo && (
          <div className="legacy-promo">
            <div className="row between">
              <strong title="Copias que anotaste como Promo antes de poder elegir el arte">Promo (sin arte concreto)</strong>
              <Stepper value={e.promo} disabled={!ready} onChange={(v) => void setInventory(cardId, { promo: v })} />
            </div>
            {variants.length > 0 && artsAvailable && (
              <label className="small field">
                <span className="muted">Pasar una de estas copias a su arte:</span>
                <select className="input" aria-label="Pasar una copia promo a un arte" disabled={!ready} value="" onChange={(ev) => ev.target.value && movePromoTo(ev.target.value)}>
                  <option value="">Elige el arte…</option>
                  {variants.map((v) => <option key={v.key} value={v.key}>{v.label} · {v.detail}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
        {showFoil && (
          <div className="row between"><strong>Foil</strong><Stepper value={e.foil} disabled={!ready} onChange={(v) => void setInventory(cardId, { foil: v })} /></div>
        )}
        {variants.length > 0 && (
          <div className="art-counts">
            <h4 className="small">Artes alternativos y promos <span className="muted">(cada diseño por separado)</span></h4>
            {!artsAvailable && <p className="notice small">Para contar artes alternativos, vuelve a ejecutar <code>supabase/schema.sql</code> en Supabase (es seguro repetirlo).</p>}
            <ul className="plain">
              {variants.map((v) => (
                <li key={v.key} className="art-row">
                  <img src={`${import.meta.env.BASE_URL}${thumbOf(v.image)}`} alt="" loading="lazy" draggable={false} />
                  <span className="art-name">
                    <strong>{v.label}</strong>
                    <small className="muted">{v.detail}{v.approx ? ' · imagen aproximada' : ''}</small>
                  </span>
                  <Stepper value={e.arts[v.key] ?? 0} disabled={!ready || !artsAvailable} onChange={(n) => void setArtCopies(cardId, v.key, n)} title={`Copias de ${v.label}`} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {!inventoryV2 && (
          <p className="notice small">Para registrar Foil y estado, vuelve a ejecutar <code>supabase/schema.sql</code> en Supabase (es seguro repetirlo).</p>
        )}
        {hiddenVersions && (
          <p className="muted small versions-note">
            {showAll ? 'Mostrando todas las versiones. ' : `${variants.length === 0 && !avail.foil ? 'Esta carta solo existe en versión normal' : 'Solo se muestran las versiones que existen para esta carta'} según el catálogo. `}
            <button type="button" className="link-btn small" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Ocultar las que no existen' : '¿Tienes una versión Foil? Mostrar'}
            </button>
          </p>
        )}

        <p className="small playset" title={isLegend ? 'Una Legend se lleva una sola vez por mazo.' : 'Un playset son 3 copias, el máximo que se puede llevar en un mazo.'}>
          <span className={`pill ${active >= size ? 'ok' : 'warn'}`}>Playset: {active} de {size} {size === 1 ? 'copia' : 'copias'}</span>{' '}
          {bulk > 0 && <span className="pill warn">Sobran {bulk} (bulk)</span>}
        </p>
        <p className="muted small">
          {isLegend && 'Una Legend se lleva una sola vez por mazo, así que su playset es 1 copia. '}
          {total === 0 && 'No tienes ninguna copia.'}
          {total > 0 && active < size && `Te ${size - active === 1 ? 'falta 1 copia' : `faltan ${size - active} copias`} para completar el playset.`}
          {total > 0 && active >= size && bulk === 0 && 'Tienes el playset completo.'}
          {bulk > 0 && `Tienes el playset completo y te ${bulk === 1 ? 'sobra 1 copia' : `sobran ${copies(bulk)}`}: van a Bulk, para cambiar o vender.`}
          {isLegend && bulk > 0 && ' Si usas esta Legend en varios mazos a la vez, guarda una copia para cada uno.'}
        </p>
        {inventoryV2 && bulk > 0 && (
          <label className="small field">
            Estado de las copias para cambio/venta
            <select className="input" disabled={!ready} value={e.condition} onChange={(ev) => void setInventory(cardId, { condition: ev.target.value as Condition })}>
              {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
            </select>
          </label>
        )}
      </div>
      <WishEditor cardId={cardId} />
    </>
  )
}

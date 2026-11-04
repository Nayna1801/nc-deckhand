import { useState } from 'react'
import { catalog } from '../lib/catalog'
import { availableVersions, CONDITIONS, CONDITION_LABEL, EMPTY_ENTRY, playsetSize, splitPlayset, totalOf, type Condition } from '../lib/inventory'
import { useData } from '../state/DataContext'
import { Stepper } from './cardUi'
import { WishEditor } from './Wish'

const copies = (n: number) => (n === 1 ? '1 copia' : `${n} copias`)

/** Copias por versión, estado de conservación, playset / bulk y lista de deseos. */
export function InventoryEditor({ cardId }: { cardId: string }) {
  const { inventory, inventoryV2, setInventory } = useData()
  const [showAll, setShowAll] = useState(false)
  const card = catalog.byId[cardId]
  const e = inventory[cardId] ?? EMPTY_ENTRY
  const total = totalOf(e)
  const size = playsetSize(card)
  const { active, bulk } = splitPlayset(total, size)
  const isLegend = card?.type === 'Legend'

  // Solo se ofrecen las versiones que existen para esta carta (o las que ya tienes anotadas)
  const avail = card ? availableVersions(card) : { foil: false, promo: false }
  const showPromo = inventoryV2 && (showAll || avail.promo || e.promo > 0)
  const showFoil = inventoryV2 && (showAll || avail.foil || e.foil > 0)
  const hiddenVersions = inventoryV2 && !(showPromo && showFoil)

  return (
    <>
      <div className="panel inventory">
        <div className="row between"><strong>Normal</strong><Stepper value={e.normal} onChange={(v) => void setInventory(cardId, { normal: v })} /></div>
        {showPromo && (
          <div className="row between"><strong>Promo / Full Art</strong><Stepper value={e.promo} onChange={(v) => void setInventory(cardId, { promo: v })} /></div>
        )}
        {showFoil && (
          <div className="row between"><strong>Foil</strong><Stepper value={e.foil} onChange={(v) => void setInventory(cardId, { foil: v })} /></div>
        )}
        {!inventoryV2 && (
          <p className="notice small">Para registrar Foil, Promo y estado, vuelve a ejecutar <code>supabase/schema.sql</code> en Supabase (es seguro repetirlo).</p>
        )}
        {hiddenVersions && (
          <p className="muted small versions-note">
            {showAll ? 'Mostrando todas las versiones. ' : `${!avail.promo && !avail.foil ? 'Esta carta solo existe en versión normal' : 'Solo se muestran las versiones que existen para esta carta'} según el catálogo. `}
            <button type="button" className="link-btn small" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Ocultar las que no existen' : '¿Tienes otra versión? Mostrar todas'}
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
            <select className="input" value={e.condition} onChange={(ev) => void setInventory(cardId, { condition: ev.target.value as Condition })}>
              {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
            </select>
          </label>
        )}
      </div>
      <WishEditor cardId={cardId} />
    </>
  )
}

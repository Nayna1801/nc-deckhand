import { CONDITIONS, CONDITION_LABEL, splitPlayset, totalOf, EMPTY_ENTRY, type Condition } from '../lib/inventory'
import { useData } from '../state/DataContext'
import { Stepper } from './cardUi'

/** Copias por versión (Normal / Foil / Promo), estado de conservación y reparto playset / bulk. */
export function InventoryEditor({ cardId }: { cardId: string }) {
  const { inventory, inventoryV2, setInventory } = useData()
  const e = inventory[cardId] ?? EMPTY_ENTRY
  const total = totalOf(e)
  const { active, bulk } = splitPlayset(total)

  return (
    <div className="panel inventory">
      <div className="row between"><strong>Normal</strong><Stepper value={e.normal} onChange={(v) => void setInventory(cardId, { normal: v })} /></div>
      {inventoryV2 ? (
        <>
          <div className="row between"><strong>Foil</strong><Stepper value={e.foil} onChange={(v) => void setInventory(cardId, { foil: v })} /></div>
          <div className="row between"><strong>Promo / Full Art</strong><Stepper value={e.promo} onChange={(v) => void setInventory(cardId, { promo: v })} /></div>
        </>
      ) : (
        <p className="notice small">Para registrar Foil, Promo y estado, vuelve a ejecutar <code>supabase/schema.sql</code> en Supabase (es seguro repetirlo).</p>
      )}
      <p className="small playset">
        <span className="pill ok">Colección activa {active}/3</span>{' '}
        {bulk > 0 && <span className="pill warn">Bulk +{bulk}</span>}
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
  )
}

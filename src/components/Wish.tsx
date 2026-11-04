import { useData } from '../state/DataContext'
import { Stepper } from './cardUi'

/** Corazón para marcar/desmarcar una carta como deseada (visible solo con sesión). */
export function WishHeart({ cardId }: { cardId: string }) {
  const { loggedIn, wishlist, wishlistAvailable, setWanted, ready } = useData()
  if (!loggedIn || !wishlistAvailable) return null
  const n = wishlist[cardId] ?? 0
  const label = n > 0 ? `En tu lista de deseos (×${n}). Pulsa para quitarla` : 'Añadir a mi lista de deseos'
  return (
    <button type="button" className={`heart ${n > 0 ? 'on' : ''}`} aria-pressed={n > 0} aria-label={label} title={ready ? label : 'Cargando tus datos…'} disabled={!ready} onClick={() => void setWanted(cardId, n > 0 ? 0 : 1)}>
      {n > 0 ? '♥' : '♡'}
    </button>
  )
}

/** Sección de la ficha: cuántas copias quieres conseguir, vayan o no a un mazo. */
export function WishEditor({ cardId }: { cardId: string }) {
  const { loggedIn, wishlist, wishlistAvailable, setWanted, collection, ready } = useData()
  if (!loggedIn) return null
  if (!wishlistAvailable) {
    return <p className="notice small">Para usar la lista de deseos, vuelve a ejecutar <code>supabase/schema.sql</code> en Supabase (es seguro repetirlo).</p>
  }
  const n = wishlist[cardId] ?? 0
  return (
    <div className="panel wish">
      <div className="row between">
        <strong>♥ Lista de deseos</strong>
        <Stepper value={n} max={99} disabled={!ready} onChange={(v) => void setWanted(cardId, v)} />
      </div>
      <p className="muted small">
        Copias que quieres conseguir, para jugar, coleccionar o cambiar: no hace falta que estén en un mazo.
        {n > 0 && (collection[cardId] ?? 0) > 0 && <> Ya tienes {collection[cardId]}.</>}
      </p>
    </div>
  )
}

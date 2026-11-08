import { Link } from 'react-router-dom'
import { CardModal, useCardModal } from '../components/cardUi'
import { InventoryEditor } from '../components/InventoryEditor'
import { Scanner } from '../components/Scanner'
import { useData } from '../state/DataContext'

export function ScanPage() {
  const { loggedIn } = useData()
  const modal = useCardModal()

  return (
    <section className="scan">
      <header className="page-head">
        <div>
          <h1>Escanear carta <span className="pill warn">prueba</span></h1>
          <p className="muted">Encaja la carta en el marco y pulsa Escanear: la app te propone las 3 cartas más parecidas. Todo se calcula en tu dispositivo; las fotos no se envían a ningún sitio.</p>
        </div>
        <Link className="btn sm" to="/">← Cartas</Link>
      </header>

      <Scanner onChoose={(c) => modal.open(c.cardId, c.printKey)} />

      <CardModal card={modal.card} printKey={modal.printKey} onClose={modal.close}>
        {modal.card && (loggedIn ? <InventoryEditor cardId={modal.card.id} /> : <p className="muted small"><Link to="/login">Inicia sesión</Link> para añadir o quitar esta carta de tu colección.</p>)}
      </CardModal>
    </section>
  )
}

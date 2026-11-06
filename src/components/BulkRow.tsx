import { useMemo } from 'react'
import { catalog } from '../lib/catalog'
import { thumbOf } from '../lib/images'
import {
  clampPick,
  CONDITIONS,
  CONDITION_LABEL,
  ownedKinds,
  pickedOf,
  pickedTotal,
  totalOf,
  withPicked,
  type Condition,
  type InventoryEntry,
  type PickedCopies,
} from '../lib/inventory'
import { variantsOf } from '../lib/variants'
import { Stepper, type PreviewBind } from './cardUi'

interface Props {
  cardId: string
  bulk: number
  condition: Condition
  entry: InventoryEntry | undefined
  checked: boolean
  onToggle: () => void
  /** Copias a retirar cuando la carta solo tiene un tipo de copia (se descuentan sin elegir). */
  qty: number
  onQty: (n: number) => void
  /** Selección exacta cuando la carta tiene varias versiones o artes. */
  pick: PickedCopies | undefined
  onPick: (p: PickedCopies) => void
  onWithdrawQty: () => void
  onWithdrawPick: (pick: PickedCopies) => void
  onOpenCard: () => void
  preview: PreviewBind
  ready: boolean
  showCondition: boolean
  onCondition: (c: Condition) => void
}

/** Una fila del bulk: con un solo tipo de copia, cantidad y «Retirar»; con varias versiones o artes, un desplegable para elegir cuáles. */
export function BulkRow(p: Props) {
  const card = catalog.byId[p.cardId]
  const kinds = useMemo(() => ownedKinds(p.entry), [p.entry])
  const labels = useMemo(() => new Map((card ? variantsOf(card) : []).map((v) => [v.key, v])), [card])
  const multi = kinds.length > 1
  const pick = clampPick(p.pick, p.entry, p.bulk)
  const chosen = pickedTotal(pick)
  const nameOf = (id: string): string =>
    id === 'normal' ? 'Normal (diseño base)' : id === 'promo' ? 'Promo (sin arte concreto)' : id === 'foil' ? 'Foil' : (labels.get(id)?.label ?? id)

  const summary = kinds
    .filter((k) => pickedOf(pick, k.id) > 0)
    .map((k) => `${pickedOf(pick, k.id)}× ${nameOf(k.id)}`)
    .join(' · ')

  return (
    <li className="bulk-row">
      <div className="deck-row">
        <input type="checkbox" checked={p.checked} onChange={p.onToggle} aria-label={`Seleccionar ${card?.displayName}`} />
        <button className="link-btn" onClick={p.onOpenCard} {...p.preview}>{card?.displayName}</button>
        <span className="pill warn">bulk ×{p.bulk}</span>
        <span className="muted small">de {totalOf(p.entry)}</span>
        {!multi && (
          <>
            <Stepper value={p.qty} min={1} max={p.bulk} disabled={!p.ready} onChange={p.onQty} title="Copias a retirar" />
            <button className="btn sm" disabled={!p.ready} onClick={p.onWithdrawQty} aria-label={`Retirar ${card?.displayName}`}>Retirar</button>
          </>
        )}
        {p.showCondition && (
          <select className="input" aria-label="Estado" disabled={!p.ready} value={p.condition} onChange={(e) => p.onCondition(e.target.value as Condition)}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
          </select>
        )}
      </div>

      {multi && (
        <details className="bulk-pick">
          <summary>
            Elegir qué retirar{chosen > 0 ? <strong> · {chosen} {chosen === 1 ? 'elegida' : 'elegidas'}</strong> : <span className="muted"> · tienes {kinds.length} versiones o artes</span>}
          </summary>
          <div className="bulk-pick-body">
            <ul className="plain">
              {kinds.map((k) => {
                const v = k.kind === 'art' ? labels.get(k.id) : undefined
                const n = pickedOf(pick, k.id)
                return (
                  <li key={k.id} className="art-row">
                    {v ? <img src={`${import.meta.env.BASE_URL}${thumbOf(v.image)}`} alt="" loading="lazy" draggable={false} /> : <span className="kind-dot" aria-hidden="true" />}
                    <span className="art-name">
                      <strong>{nameOf(k.id)}</strong>
                      <small className="muted">tienes {k.owned}{v ? ` · ${v.detail}` : ''}</small>
                    </span>
                    <Stepper
                      value={n}
                      max={k.owned}
                      disabled={!p.ready}
                      disableAdd={chosen >= p.bulk}
                      addTitle={`Solo sobran ${p.bulk} (el resto es tu playset)`}
                      onChange={(value) => p.onPick(withPicked(pick, k.id, value))}
                      title={`Copias de ${nameOf(k.id)} a retirar`}
                    />
                  </li>
                )
              })}
            </ul>
            <div className="row between bulk-pick-foot">
              <span className="small muted">
                {chosen > 0 ? `Se retirarán: ${summary}.` : `Elige hasta ${p.bulk} ${p.bulk === 1 ? 'copia' : 'copias'} (las que pasan del playset).`}
              </span>
              <button className="btn primary sm" disabled={!p.ready || chosen === 0} onClick={() => p.onWithdrawPick(pick)} aria-label={`Retirar lo elegido de ${card?.displayName}`}>
                Retirar lo elegido{chosen > 0 ? ` (${chosen})` : ''}
              </button>
            </div>
          </div>
        </details>
      )}
    </li>
  )
}

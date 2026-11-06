import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

export interface Option {
  value: string
  label: string
}

interface BaseProps {
  /** Nombre del filtro: se muestra como etiqueta pequeña y se usa como nombre accesible. */
  label: string
  options: Option[]
}

interface SingleProps extends BaseProps {
  multiple?: false
  value: string
  onChange: (value: string) => void
}

/**
 * Selección múltiple: la lista no se cierra al elegir y la opción con valor '' ("Todos") vacía la selección.
 * Un valor vacío (`[]`) significa "sin filtro".
 */
interface MultiProps extends BaseProps {
  multiple: true
  value: string[]
  onChange: (value: string[]) => void
}

type Props = SingleProps | MultiProps

/** Texto que muestra el botón de un desplegable múltiple. */
export function summarize(options: Option[], values: string[]): string {
  if (values.length === 0) return options.find((o) => o.value === '')?.label ?? 'Todos'
  const labels = values.map((v) => options.find((o) => o.value === v)?.label ?? v)
  return labels.length <= 2 ? labels.join(' + ') : `${labels.length} elegidos`
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

/** Desplegable accesible (patrón listbox) con la forma de la interfaz: esquinas cortadas y borde de neón. */
export function Dropdown(props: Props) {
  const { label, options } = props
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [alignRight, setAlignRight] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const typed = useRef({ text: '', timer: 0 })
  const uid = useId()

  const multiple = props.multiple === true
  const selected: string[] = props.multiple ? props.value : props.value === '' ? [] : [props.value]
  const isChosen = (v: string) => (v === '' ? selected.length === 0 : selected.includes(v))
  const firstChosen = options.findIndex((o) => o.value !== '' && selected.includes(o.value))
  const selectedIndex = multiple ? Math.max(0, firstChosen) : Math.max(0, options.findIndex((o) => o.value === props.value))
  const shown = multiple ? summarize(options, selected) : (options[selectedIndex]?.label ?? '')
  const isSet = selected.length > 0 && options[0]?.value === ''

  // abrir: posicionar, enfocar la lista y empezar en la opción elegida
  useEffect(() => {
    if (!open) return
    setActive(selectedIndex)
    const r = button.current?.getBoundingClientRect()
    setAlignRight(!!r && r.left + 260 > window.innerWidth)
    list.current?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // cerrar al hacer clic o tocar fuera
  useEffect(() => {
    if (!open) return
    const outside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('touchstart', outside)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('touchstart', outside)
    }
  }, [open])

  // mantener visible la opción activa
  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  useEffect(() => () => window.clearTimeout(typed.current.timer), [])

  const choose = (i: number) => {
    const v = options[i].value
    if (props.multiple) {
      // la lista sigue abierta: se puede marcar y desmarcar varias opciones seguidas
      props.onChange(v === '' ? [] : selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
      list.current?.focus({ preventScroll: true })
      return
    }
    props.onChange(v)
    setOpen(false)
    button.current?.focus()
  }

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
    }
  }

  const onListKey = (e: KeyboardEvent) => {
    const last = options.length - 1
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((i) => Math.min(last, i + 1))
        return
      case 'ArrowUp':
        e.preventDefault()
        setActive((i) => Math.max(0, i - 1))
        return
      case 'Home':
        e.preventDefault()
        setActive(0)
        return
      case 'End':
        e.preventDefault()
        setActive(last)
        return
      case 'Enter':
      case ' ':
        e.preventDefault()
        choose(active)
        return
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        button.current?.focus()
        return
      case 'Tab':
        setOpen(false)
        return
    }
    // búsqueda por letras
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      window.clearTimeout(typed.current.timer)
      typed.current.text += norm(e.key)
      typed.current.timer = window.setTimeout(() => (typed.current.text = ''), 600)
      const hit = options.findIndex((o) => norm(o.label).startsWith(typed.current.text))
      if (hit >= 0) setActive(hit)
    }
  }

  return (
    <div className={`dd ${open ? 'open' : ''} ${isSet ? 'is-set' : ''}`} ref={root}>
      <button
        ref={button}
        type="button"
        className="dd-btn"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${uid}-list` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKey}
      >
        <span className="dd-in">
          <span className="dd-cap">{label}</span>
          <span className="dd-val">{shown}</span>
          <span className="dd-chev" aria-hidden="true">▾</span>
        </span>
      </button>
      {open && (
        <div className={`dd-pop ${alignRight ? 'right' : ''}`}>
          {/* .dd-frame lleva el borde y el relleno (no se desplaza); la lista hace scroll dentro */}
          <div className="dd-frame">
          <ul
            ref={list}
            id={`${uid}-list`}
            className="dd-list"
            role="listbox"
            tabIndex={-1}
            aria-label={label}
            aria-multiselectable={multiple || undefined}
            aria-activedescendant={`${uid}-opt-${active}`}
            onKeyDown={onListKey}
          >
            {options.map((o, i) => (
              <li
                key={o.value || '__all'}
                id={`${uid}-opt-${i}`}
                role="option"
                data-index={i}
                data-value={o.value}
                aria-selected={isChosen(o.value)}
                className={`dd-opt ${i === active ? 'active' : ''} ${isChosen(o.value) ? 'selected' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
              >
                {o.label}
              </li>
            ))}
          </ul>
          </div>
        </div>
      )}
    </div>
  )
}

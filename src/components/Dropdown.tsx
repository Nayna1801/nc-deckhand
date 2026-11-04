import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

export interface Option {
  value: string
  label: string
}

interface Props {
  /** Nombre del filtro: se muestra como etiqueta pequeña y se usa como nombre accesible. */
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

/** Desplegable accesible (patrón listbox) con la forma de la interfaz: esquinas cortadas y borde de neón. */
export function Dropdown({ label, value, options, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [alignRight, setAlignRight] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const typed = useRef({ text: '', timer: 0 })
  const uid = useId()

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value))
  const current = options[selectedIndex]
  const isSet = value !== '' && options[0]?.value === ''

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
    onChange(options[i].value)
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
          <span className="dd-val">{current?.label ?? ''}</span>
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
                aria-selected={o.value === value}
                className={`dd-opt ${i === active ? 'active' : ''} ${o.value === value ? 'selected' : ''}`}
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

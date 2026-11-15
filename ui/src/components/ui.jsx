import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

// Riot-style buttons: red pill with a sliding dark fill (primary), outlined pill (secondary), bare text links.
const BTN = {
  primary: 'btn-riot rounded-full font-bold text-white',
  secondary: 'rounded-full border border-border-strong font-bold text-text hover:border-text disabled:text-muted disabled:hover:border-border-strong',
  ghost: 'font-semibold text-muted hover:text-text disabled:opacity-50',
  danger: 'font-semibold text-accent-text hover:underline disabled:opacity-50',
}

export function Button({ variant = 'secondary', size = 'md', className = '', to, children, ...rest }) {
  const sizes = { sm: 'h-8 px-4 text-[11px] uppercase tracking-[0.06em]', md: 'h-11 px-7 text-sm tracking-tight' }
  const pad = variant === 'ghost' || variant === 'danger' ? 'h-8 px-0 text-sm' : sizes[size]
  const cls = `inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors disabled:cursor-not-allowed ${pad} ${BTN[variant]} ${className}`
  if (to) return <Link to={to} className={cls} {...rest}>{children}</Link>
  if (rest.href) return <a className={cls} {...rest}>{children}</a>
  return <button className={cls} {...rest}>{children}</button>
}

/** Section with a small heading and a hairline above it. */
export function Section({ title, right, children, className = '' }) {
  return (
    <section className={`border-t border-border pt-5 ${className}`}>
      {(title || right) && (
        <div className="mb-4 flex items-baseline justify-between gap-4">
          {title && <h2 className="font-display text-2xl font-bold">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

/** One component for the shared states every component must define. */
export function StateView({ kind, title, children, action }) {
  const icon = { empty: '○', loading: '◐', error: '!', done: '✓' }[kind]
  const tone = { empty: 'text-muted', loading: 'text-info animate-pulse-soft', error: 'text-warning', done: 'text-success' }[kind]
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className="py-16 text-center">
      <span aria-hidden className={`font-mono text-xl ${tone}`}>{icon}</span>
      <p className="mt-2 font-display text-xl font-bold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorPanel({ error, onRetry }) {
  return (
    <div role="alert" className="flex items-start gap-4 border-l-2 border-warning py-1 pl-4">
      <div className="flex-1">
        <p className="font-semibold text-warning">{error.title}</p>
        <p className="mt-0.5 text-sm text-muted">{error.message}</p>
      </div>
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  )
}

/** Simple up arrow for upvote / popularity counts. Inherits the text color (muted where used). */
export function UpvoteIcon({ className = '' }) {
  return (
    <svg aria-hidden viewBox="0 0 12 12" className={`inline-block h-3 w-3 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 10V2.5M2.5 6 6 2.5 9.5 6" />
    </svg>
  )
}

/** Version dropdown shown at the top of the Spec and Playtest pages. */
export function VersionPicker({ label, value, onChange, options, note }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <label className="inline-flex items-center gap-2 text-xs text-muted">
        Version
        <select aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))} className="select-pill">
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      {note && <span className="text-sm text-muted">{note}</span>}
    </div>
  )
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse-soft rounded bg-surface-2 ${className}`} />
}

/** Small popover menu ("⋯"). Closes on outside click and Escape. */
export function Menu({ label, trigger = '⋯', children, align = 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 min-w-8 items-center justify-center rounded-full px-2.5 text-muted hover:bg-surface-2 hover:text-text"
      >
        {trigger}
      </button>
      {open && (
        <div role="menu" onClick={() => setOpen(false)} className={`absolute top-full z-30 mt-1 w-56 max-h-80 overflow-y-auto rounded-lg border border-border bg-surface py-1.5 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {children}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ children, ...rest }) {
  return (
    <button type="button" role="menuitem" className="block w-full px-3 py-2 text-left text-sm text-text hover:bg-surface-2 disabled:text-muted disabled:hover:bg-transparent" {...rest}>
      {children}
    </button>
  )
}

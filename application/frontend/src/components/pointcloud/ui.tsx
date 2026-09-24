import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'

/**
 * Building blocks shared by the Point Cloud View panels. Sizes are Figma design
 * px (1440 × ~804 frame); the parent stage scales them to the viewport.
 *
 * Glass system — every floating surface uses the same recipe: translucent
 * fill + 1px light border + 7.8px backdrop blur + soft shadow:
 *   HUD_SURFACE  small controls, toolbar, status bars, tilt/heading (grey glass)
 *   SIDE_PANEL   the large left / right panels (same family, slightly cooler tint)
 *   MENU_SURFACE dropdown menus (same glass, more opaque for legibility)
 */

/** Figma glass surface: rgba(117,117,117,.31), 1px border, 7.8px backdrop blur, 5px radius. */
export const HUD_SURFACE = 'rounded-[5px] border border-hud-border bg-hud backdrop-blur-[7.8px]'

/** Shell shared by the left and right panels — translucent, the model stays faintly visible behind. */
export const SIDE_PANEL =
  'pointer-events-auto absolute overflow-hidden rounded-[7px] border border-white/[0.1] bg-[rgba(32,38,43,0.6)] font-sans text-white shadow-glass backdrop-blur-[7.8px]'

export const MENU_SURFACE =
  'rounded-[4px] border border-white/[0.12] bg-[rgba(30,35,39,0.94)] shadow-glass backdrop-blur-[7.8px]'

/** Interaction states, kept inside the neutral grey/white system. */
export const HOVER = 'transition-colors hover:bg-white/[0.12]'
/**
 * Active state of the central control panel (a tool / mode / panel that is ON):
 * the app's accent blue (#0083D5, same as Invite). Inactive buttons keep the
 * dark glass look — blue always means "active", never decoration.
 */
export const ACTIVE_BLUE = 'border-[#0083D5] bg-[#0083D5] transition-colors hover:bg-[#1592e6]'
export const DISABLED = 'cursor-not-allowed opacity-40'
export const FOCUS_RING = 'outline-none focus-visible:ring-1 focus-visible:ring-white/60'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/* ------------------------------ floating tool panels ------------------------------ */

/** Figma width of the bottom toolbar (its centre sits at 50 % + 3.5 px of the stage). */
const TOOLBAR_HALF_WIDTH = 717 / 2

/**
 * Glass panel floating 5 px above the central control panel (Rotations, Crop —
 * reference `context/central_control_panel.png`). `left` is the panel's x in
 * TOOLBAR design px, so it tracks the toolbar through `--pc-toolbar-scale` just
 * like the toolbar itself. Title top-left, optional header `actions`, close (X)
 * top-right.
 */
export function FloatingPanel({
  title,
  label,
  left,
  width,
  height,
  onClose,
  actions,
  children,
}: {
  title: string
  label: string
  left: number
  width: number
  height: number
  onClose: () => void
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="pointer-events-auto absolute bottom-[calc(28px+51px*var(--pc-toolbar-scale,1))] rounded-[5px] border border-hud-border bg-hud-tilt backdrop-blur-[7.8px]"
      style={{ left: `calc(50% + 3.5px + ${left - TOOLBAR_HALF_WIDTH}px * var(--pc-toolbar-scale, 1))`, width, height }}
    >
      <span className="absolute left-[7px] top-[5px] font-jersey10 text-[14px] leading-[15px] text-white">{title}</span>
      <div className="absolute right-[9px] top-[4px] flex items-center gap-[5px]">
        {actions}
        <button
          type="button"
          title="Close"
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={onClose}
          className={`${HUD_SURFACE} ${HOVER} ${FOCUS_RING} flex h-[13px] w-[13px] items-center justify-center`}
        >
          <X size={9} strokeWidth={2.4} color="#fff" />
        </button>
      </div>
      {children}
    </div>
  )
}

/** A rounded glass card inside a floating panel (one Tilt / Heading / X / Y / Z row). */
export const FLOAT_CARD = 'absolute rounded-[5px] border border-hud-border bg-hud backdrop-blur-[7.8px]'

/* ------------------------------ sections ------------------------------ */

interface SectionHeaderProps {
  icon: ReactNode
  title: ReactNode
  /** Header row height in design px (the reference varies between sections). */
  height?: number
  /** Extra header content (e.g. a status badge), shown before the collapse chevron. */
  right?: ReactNode
  /** Accordion state; with `onToggle` the whole header row expands / collapses the section. */
  open?: boolean
  onToggle?: () => void
}

/**
 * A titled box inside a side panel; the header carries an icon and a collapse
 * chevron. Sections are accordions: `defaultOpen` sets the initial state, the
 * header toggles it. The `className` height is the EXPANDED height — collapsed,
 * the section shrinks to its header row (`!h-auto`) and its body is unmounted.
 */
export function PanelSection({
  className = '',
  children,
  defaultOpen = true,
  ...header
}: SectionHeaderProps & { className?: string; children?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`rounded-[5px] border border-pc-line bg-pc-box ${className} ${open ? '' : '!h-auto'}`}>
      <SectionHeader {...header} open={open} onToggle={() => setOpen((v) => !v)} />
      {open && children}
    </section>
  )
}

export function SectionHeader({ icon, title, height = 21, right, open = true, onToggle }: SectionHeaderProps) {
  const chevron = open ? (
    <ChevronUp size={9} strokeWidth={2} className="shrink-0 text-pc-muted" />
  ) : (
    <ChevronDown size={9} strokeWidth={2} className="shrink-0 text-pc-muted" />
  )
  if (!onToggle) {
    return (
      <header className="flex items-center pl-[8px] pr-[7px]" style={{ height }}>
        <span className="flex w-[13px] justify-center text-pc-text">{icon}</span>
        <h3 className="ml-[8px] flex-1 text-[7.7px] font-semibold leading-none text-white">{title}</h3>
        {right ?? chevron}
      </header>
    )
  }
  return (
    <header style={{ height }}>
      <h3 className="h-full">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={`flex h-full w-full items-center gap-[6px] rounded-[5px] pl-[8px] pr-[7px] text-left ${HOVER} ${FOCUS_RING}`}
        >
          <span className="flex w-[13px] shrink-0 justify-center text-pc-text">{icon}</span>
          <span className="ml-[2px] flex-1 text-[7.7px] font-semibold leading-none text-white">{title}</span>
          {right}
          {chevron}
        </button>
      </h3>
    </header>
  )
}

/** Rounded read-out box (e.g. "100%", "3 px", "0.5 – 1.0"). */
export function ValueBox({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center rounded-[4px] border border-pc-line bg-pc-field text-[6.8px] text-pc-text ${className}`}
    >
      {children}
    </div>
  )
}

/* ------------------------------ toggle ------------------------------ */

/** Pill switch. `on` = light knob on the right, `off` = dim knob on the left. */
export function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative block h-[9px] w-[18px] shrink-0 rounded-full transition-colors ${FOCUS_RING} ${
        on ? 'bg-[#5d6367] hover:bg-[#6c7378]' : 'bg-[#2a2f33] hover:bg-[#363c41]'
      }`}
    >
      <span
        className={`absolute top-[1px] h-[7px] w-[7px] rounded-full transition-all ${
          on ? 'right-[1px] bg-[#e3e5e7]' : 'left-[1px] bg-[#8b9094]'
        }`}
      />
    </button>
  )
}

/* ------------------------------ sliders ------------------------------ */

/**
 * Pointer + keyboard drag for a horizontal track. `onFraction` gets 0–1 while
 * dragging, `onEnd` fires on release (use it to commit an undo step).
 */
function useTrackDrag(
  onFraction: (fraction: number, phase: 'start' | 'move') => void,
  onEnd: () => void,
  disabled: boolean,
) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const fraction = (event: PointerEvent) => {
    const rect = ref.current?.getBoundingClientRect()
    return rect && rect.width > 0 ? clamp01((event.clientX - rect.left) / rect.width) : 0
  }
  return {
    ref,
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (disabled) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragging.current = true
        onFraction(fraction(event), 'start')
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        if (dragging.current) onFraction(fraction(event), 'move')
      },
      onPointerUp: () => {
        if (!dragging.current) return
        dragging.current = false
        onEnd()
      },
      onPointerCancel: () => {
        if (!dragging.current) return
        dragging.current = false
        onEnd()
      },
    },
  }
}

const TRACK = 'absolute inset-x-0 top-[2.25px] h-[3.5px] rounded-full'
const KNOB = 'absolute top-0 h-[8px] w-[8px] -translate-x-1/2 rounded-full bg-[#f6f7f8] shadow-[0_0_0_1px_rgba(0,0,0,0.35)]'
/** Invisible, taller hit area so the 8px track is easy to grab. */
const HIT = `absolute -inset-y-[6px] inset-x-[-4px] cursor-pointer ${FOCUS_RING} rounded-[3px]`

interface SliderProps {
  label: string
  /** Text announced/tooltipped for the current value. */
  valueText?: string
  disabled?: boolean
  /** Keyboard step as a 0–1 fraction. */
  step?: number
  onCommit?: () => void
}

/** Single-value slider: `value` is 0–1. */
export function SliderTrack({
  value,
  onChange,
  onCommit = () => {},
  label,
  valueText,
  disabled = false,
  step = 0.02,
}: SliderProps & { value: number; onChange: (value: number) => void }) {
  const { ref, handlers } = useTrackDrag((f) => onChange(f), onCommit, disabled)
  const onKeyDown = (event: KeyboardEvent) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : 0
    if (event.key === 'Home') onChange(0)
    else if (event.key === 'End') onChange(1)
    else if (delta) onChange(clamp01(value + delta))
    else return
    event.preventDefault()
  }
  return (
    <div ref={ref} className={`relative h-[8px] ${disabled ? DISABLED : ''}`}>
      <div className={`${TRACK} bg-[#2c3136]`} />
      <div className={`${TRACK} bg-[#9b9ea2]`} style={{ width: `${value * 100}%` }} />
      <div className={KNOB} style={{ left: `${value * 100}%` }} />
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={valueText}
        aria-disabled={disabled}
        title={valueText}
        className={HIT}
        onKeyDown={onKeyDown}
        onKeyUp={() => onCommit()}
        {...handlers}
      />
    </div>
  )
}

/** Thin white value marker of the floating-panel bars (Rotations / Crop reference style). */
const TICK = 'pointer-events-none absolute -bottom-[3px] -top-[3px] w-px -translate-x-1/2 bg-white'

/**
 * Two-knob range slider: `from` / `to` are 0–1; the nearest knob follows the pointer.
 * `variant="bar"` = the floating-panel look (flat bar, white fill between two tick
 * marks, like `BarSlider`); the default is the side-panel knob track.
 */
export function RangeTrack({
  from,
  to,
  onChange,
  onCommit = () => {},
  label,
  valueText,
  disabled = false,
  step = 0.02,
  variant = 'knob',
  className = '',
}: SliderProps & {
  from: number
  to: number
  onChange: (range: { from?: number; to?: number }) => void
  variant?: 'knob' | 'bar'
  className?: string
}) {
  const active = useRef<'from' | 'to'>('to')
  const { ref, handlers } = useTrackDrag(
    (f, phase) => {
      if (phase === 'start') {
        const dFrom = Math.abs(f - from)
        const dTo = Math.abs(f - to)
        active.current = dFrom < dTo ? 'from' : dTo < dFrom ? 'to' : f < from ? 'from' : 'to'
      }
      onChange({ [active.current]: f })
    },
    onCommit,
    disabled,
  )
  const onKeyDown = (event: KeyboardEvent) => {
    const knob: 'from' | 'to' = event.shiftKey ? 'from' : 'to'
    const current = knob === 'from' ? from : to
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : 0
    if (!delta) return
    onChange({ [knob]: clamp01(current + delta) })
    event.preventDefault()
  }
  const bar = variant === 'bar'
  return (
    <div
      ref={ref}
      className={`relative ${bar ? 'bg-[rgba(150,150,150,0.51)]' : 'h-[8px]'} ${disabled ? DISABLED : ''} ${className}`}
    >
      {bar ? (
        <>
          <div className="absolute inset-y-0 bg-[#f8f8f8]" style={{ left: `${from * 100}%`, width: `${(to - from) * 100}%` }} />
          <div className={TICK} style={{ left: `${from * 100}%` }} />
          <div className={TICK} style={{ left: `${to * 100}%` }} />
        </>
      ) : (
        <>
          <div className={`${TRACK} bg-[#2c3136]`} />
          <div
            className={`${TRACK} bg-[#b3b6ba]`}
            style={{ left: `${from * 100}%`, width: `${(to - from) * 100}%` }}
          />
          <div className={KNOB} style={{ left: `${from * 100}%` }} />
          <div className={KNOB} style={{ left: `${to * 100}%` }} />
        </>
      )}
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(to * 100)}
        aria-valuetext={valueText}
        aria-disabled={disabled}
        title={valueText}
        className={HIT}
        onKeyDown={onKeyDown}
        onKeyUp={() => onCommit()}
        {...handlers}
      />
    </div>
  )
}

/** Tilt / Heading style slider: a filled bar (no knob). `value` is 0–1. */
export function BarSlider({
  value,
  onChange,
  onCommit = () => {},
  label,
  valueText,
  disabled = false,
  step = 0.01,
  className = '',
}: SliderProps & { value: number; onChange: (value: number) => void; className?: string }) {
  const { ref, handlers } = useTrackDrag((f) => onChange(f), onCommit, disabled)
  const onKeyDown = (event: KeyboardEvent) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : 0
    if (!delta) return
    onChange(clamp01(value + delta))
    event.preventDefault()
  }
  return (
    <div ref={ref} className={`relative bg-[rgba(150,150,150,0.51)] ${disabled ? DISABLED : ''} ${className}`}>
      <div className="h-full bg-[#f8f8f8]" style={{ width: `${value * 100}%` }} />
      <div className={TICK} style={{ left: `${value * 100}%` }} />
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={valueText}
        aria-disabled={disabled}
        title={valueText}
        className={`absolute -inset-y-[4px] inset-x-0 cursor-pointer ${FOCUS_RING}`}
        onKeyDown={onKeyDown}
        onKeyUp={() => onCommit()}
        {...handlers}
      />
    </div>
  )
}

/* ------------------------------ inputs ------------------------------ */

/** Text-like numeric input that commits on Enter / blur (keeps the typed text while editing). */
export function NumberField({
  value,
  onCommit,
  label,
  className = '',
  digits = 0,
}: {
  value: number
  onCommit: (value: number) => void
  label: string
  className?: string
  digits?: number
}) {
  const format = (v: number) => (Number.isFinite(v) ? v.toFixed(digits) : '')
  const [draft, setDraft] = useState<string | null>(null)
  const finish = () => {
    if (draft === null) return
    const parsed = Number.parseFloat(draft)
    if (Number.isFinite(parsed)) onCommit(parsed)
    setDraft(null)
  }
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      value={draft ?? format(value)}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') {
          setDraft(null)
          event.currentTarget.blur()
        }
      }}
      className={`w-full bg-transparent text-white ${FOCUS_RING} ${className}`}
    />
  )
}

/** Small dropdown (button + glass menu) used by the Selection Mode selector. */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  className = '',
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  const current = options.find((option) => option.value === value)
  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-full w-full items-center justify-between rounded-[4px] border border-pc-line bg-pc-field pl-[8px] pr-[6px] text-[6.8px] text-white ${HOVER} ${FOCUS_RING}`}
      >
        {current?.label}
        <ChevronDown size={8} strokeWidth={2} className="text-pc-text" />
      </button>
      {open && (
        <ul role="listbox" className={`absolute left-0 top-[calc(100%+2px)] z-30 min-w-full overflow-hidden ${MENU_SURFACE}`}>
          {options.map((option) => (
            <li key={option.value} role="option" aria-selected={option.value === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={`block w-full whitespace-nowrap px-[8px] py-[4px] text-left text-[6.8px] text-white ${HOVER} ${
                  option.value === value ? 'bg-white/[0.14]' : ''
                }`}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// The Exam's Page Margins, set from the Format menu (ADR-0039).
//
// Shaped like a design tool's corner-radius control: one slider and one field
// set all four sides at once, and a toggle beside them opens a row for each
// side. When the sides differ the combined field says "Mixed", and moving the
// combined slider sets every side to where it lands. Nothing waits for a
// confirm: every change is the Exam's at once, and the sheet behind the panel
// reflows to it.
//
// A floating panel rather than rows in the Format menu itself: a menu closes on
// any scroll, and a sheet that loses a page as its margins shrink scrolls under
// the pointer mid-drag. The panel stays until Escape, its close button, or a
// press outside it.

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PanelBottom, PanelLeft, PanelRight, PanelTop, Scan, SquareDashed, X } from 'lucide-react'
import type { MenuPoint } from './context-menu'
import {
  MARGIN_SIDES,
  MARGIN_SIDE_LABELS,
  MARGIN_STEP,
  MAX_MARGIN,
  MIN_MARGIN,
  clampMargin,
  marginsOf,
  uniformMarginOf,
  type MarginSide,
  type PageMargins,
} from './page-margins'

const SIDE_ICONS: Record<MarginSide, ReactNode> = {
  top: <PanelTop />,
  right: <PanelRight />,
  bottom: <PanelBottom />,
  left: <PanelLeft />,
}

/** A margin as the field shows it: no trailing zeros, never a float's tail. */
function formatInches(inches: number): string {
  return String(Math.round(inches * 100) / 100)
}

const VIEWPORT_MARGIN = 8

/** One control: a slider and a field in inches, for one side or for all. */
function MarginControl({
  label,
  icon,
  value,
  disabled,
  onChange,
}: {
  label: string
  icon: ReactNode
  /** The inches it shows, or `null` for sides that differ. */
  value: number | null
  disabled: boolean
  onChange: (inches: number, continuing: boolean) => void
}) {
  const fieldId = useId()
  // `null` between drags. During one, whether a change has been made yet: the
  // first change of a drag makes an undo step and the rest join it.
  const dragging = useRef<boolean | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const shown = value === null ? '' : formatInches(value)
  // Where the slider's thumb rests while the sides differ: in the middle of the
  // range, so a drag either way is a real change for every side.
  const sliderValue = value ?? (MIN_MARGIN + MAX_MARGIN) / 2

  const commit = (text: string) => {
    setDraft(null)
    const inches = Number.parseFloat(text)
    if (!Number.isFinite(inches)) return
    onChange(clampMargin(inches), false)
  }

  return (
    <div className="margins-row">
      <label className="margins-row-label" htmlFor={fieldId} title={label}>
        <span className="margins-row-icon" aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </label>
      <input
        type="range"
        className="margins-slider"
        aria-label={`${label} margin`}
        aria-valuetext={value === null ? 'Mixed' : `${formatInches(value)} inches`}
        min={MIN_MARGIN}
        max={MAX_MARGIN}
        step={MARGIN_STEP}
        value={sliderValue}
        disabled={disabled}
        onPointerDown={() => { dragging.current = false }}
        onPointerUp={() => { dragging.current = null }}
        onPointerCancel={() => { dragging.current = null }}
        onChange={(event) => {
          const continuing = dragging.current === true
          if (dragging.current !== null) dragging.current = true
          onChange(clampMargin(Number(event.target.value)), continuing)
        }}
      />
      <span className="margins-field">
        <input
          id={fieldId}
          type="text"
          inputMode="decimal"
          className="margins-input"
          aria-label={`${label} margin in inches`}
          value={draft ?? shown}
          placeholder={value === null ? 'Mixed' : undefined}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => { if (draft !== null) commit(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit(event.currentTarget.value)
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              setDraft(null)
              const from = value ?? sliderValue
              onChange(clampMargin(from + (event.key === 'ArrowUp' ? MARGIN_STEP : -MARGIN_STEP)), false)
            } else if (event.key === 'Escape' && draft !== null) {
              // The first Escape abandons what was typed; the next closes.
              event.stopPropagation()
              setDraft(null)
            }
          }}
        />
        {(value !== null || draft !== null) && <span className="margins-unit" aria-hidden="true">in</span>}
      </span>
    </div>
  )
}

export function MarginsPanel({
  point,
  margins,
  disabled = false,
  onChange,
  onClose,
}: {
  point: MenuPoint
  margins: PageMargins | undefined
  disabled?: boolean
  /** Sets `sides` to `inches`; `continuing` a drag that already made its step. */
  onChange: (sides: readonly MarginSide[], inches: number, continuing: boolean) => void
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<MenuPoint>(point)
  const resolved = marginsOf(margins)
  const uniform = uniformMarginOf(margins)
  // Open on each side when the sides already differ: that is what there is
  // to see. Otherwise the one control is the whole of it until asked.
  const [expanded, setExpanded] = useState(uniform === null)

  // Clamped into the viewport before it paints, like the menu it came from.
  useLayoutEffect(() => {
    const element = panel.current
    if (!element) return
    const maxX = window.innerWidth - element.offsetWidth - VIEWPORT_MARGIN
    const maxY = window.innerHeight - element.offsetHeight - VIEWPORT_MARGIN
    setPosition({
      x: Math.max(VIEWPORT_MARGIN, Math.min(point.x, maxX)),
      y: Math.max(VIEWPORT_MARGIN, Math.min(point.y, maxY)),
    })
  }, [point, expanded])

  useEffect(() => {
    panel.current?.querySelector<HTMLInputElement>('.margins-slider')?.focus()
  }, [])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [onClose])

  return createPortal(
    <div
      ref={panel}
      className="margins-panel"
      role="dialog"
      aria-label="Margins"
      style={{ left: position.x, top: position.y }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      <div className="margins-panel-header">
        <span className="margins-panel-title">Margins</span>
        <button
          type="button"
          className="margins-panel-close"
          aria-label="Close margins"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="margins-combined">
        <MarginControl
          label="All sides"
          icon={<Scan />}
          value={uniform}
          disabled={disabled}
          onChange={(inches, continuing) => onChange(MARGIN_SIDES, inches, continuing)}
        />
        <button
          type="button"
          className="margins-expand"
          aria-label="Set each side"
          title="Set each side"
          aria-expanded={expanded}
          aria-pressed={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          <SquareDashed aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div className="margins-sides" role="group" aria-label="Each side">
          {MARGIN_SIDES.map((side) => (
            <MarginControl
              key={side}
              label={MARGIN_SIDE_LABELS[side]}
              icon={SIDE_ICONS[side]}
              value={resolved[side]}
              disabled={disabled}
              onChange={(inches, continuing) => onChange([side], inches, continuing)}
            />
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}

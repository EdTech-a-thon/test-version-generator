// The resizable split the authoring workspace is laid out in.
//
// The Question Bank and the rendered Exam Draft open at an even split, so
// neither reads as the lesser one, and the teacher moves the divider to give
// more room to whichever side they are working in. On a narrow screen the bank
// collapses to a rail instead of squeezing the sheet, because the sheet is a
// piece of paper: it keeps its real printable geometry and the pane scrolls,
// rather than being scaled down to show a layout the printer will not produce.
//
// The width and the collapsed state live here and nowhere else. They are a view
// of the workspace, not authoring data: they never reach the store, never dirty
// the exam, never enter undo history and are gone on reload — the same rule the
// bank's search, filters and row selection already follow.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { PanelLeftOpen } from 'lucide-react'

/** Below this the workspace has no room for two panes side by side, so the bank
 *  starts out of the way and the sheet keeps the width. */
export const NARROW_WORKSPACE_QUERY = '(max-width: 880px)'

const DEFAULT_BANK_PERCENT = 50
// Neither pane is allowed to become a sliver: past these the divider is no
// longer resizing a split, it is collapsing one side without saying so.
const MIN_BANK_PERCENT = 20
const MAX_BANK_PERCENT = 80
/** How much one arrow-key press moves the divider. */
const KEYBOARD_STEP = 4
/** The rail the collapsed bank leaves behind, wide enough for the control that
 *  brings it back. */
const COLLAPSED_RAIL = '44px'

const clampPercent = (percent: number) =>
  Math.min(MAX_BANK_PERCENT, Math.max(MIN_BANK_PERCENT, percent))

function prefersNarrowWorkspace(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.(NARROW_WORKSPACE_QUERY).matches === true
}

export function WorkspaceSplit({
  bank,
  examDraft,
}: {
  /** The Question Bank pane, given the way to put itself away. */
  bank: (controls: { collapse: () => void }) => ReactNode
  examDraft: ReactNode
}) {
  const [bankPercent, setBankPercent] = useState(DEFAULT_BANK_PERCENT)
  // A workspace that opens too narrow for two panes opens with one. The teacher
  // can always bring the bank back; what they are never given is a sheet with
  // no room to be a sheet.
  const [collapsed, setCollapsed] = useState(prefersNarrowWorkspace)
  const container = useRef<HTMLDivElement>(null)

  // A workspace that becomes too narrow — a rotated tablet, a dragged window —
  // puts the bank away, for the same reason it opened with it away. It never
  // brings it back: widening the window is not a request to see the bank, and
  // undoing a teacher's deliberate collapse because their window grew would be
  // the layout arguing with them.
  useEffect(() => {
    const media = window.matchMedia?.(NARROW_WORKSPACE_QUERY)
    if (!media) return
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setCollapsed(true)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resizeTo = useCallback((clientX: number) => {
    const bounds = container.current?.getBoundingClientRect()
    if (!bounds || bounds.width === 0) return
    setBankPercent(clampPercent(((clientX - bounds.left) / bounds.width) * 100))
  }, [])

  const dragging = useRef<number | null>(null)

  const style = {
    '--bank-column': collapsed ? COLLAPSED_RAIL : `${bankPercent}%`,
  } as CSSProperties

  return (
    <div
      className="authoring-workspace"
      ref={container}
      style={style}
      data-bank-collapsed={collapsed ? 'true' : undefined}
    >
      {collapsed ? (
        <div className="question-bank-rail">
          <button
            type="button"
            className="question-bank-action"
            aria-label="Show the Question Bank"
            title="Show the Question Bank"
            onClick={() => setCollapsed(false)}
          >
            <PanelLeftOpen />
          </button>
        </div>
      ) : (
        <>
          {bank({ collapse: () => setCollapsed(true) })}
          {/* The divider is a real control rather than a decorated border: it
              takes focus and answers the arrow keys, so the split is resizable
              without a pointer. */}
          <div
            className="workspace-resizer"
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize the Question Bank"
            aria-valuenow={Math.round(bankPercent)}
            aria-valuemin={MIN_BANK_PERCENT}
            aria-valuemax={MAX_BANK_PERCENT}
            onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
              if (event.button !== 0) return
              event.preventDefault()
              dragging.current = event.pointerId
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
              if (dragging.current !== event.pointerId) return
              resizeTo(event.clientX)
            }}
            onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) => {
              if (dragging.current !== event.pointerId) return
              dragging.current = null
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            }}
            onLostPointerCapture={() => {
              dragging.current = null
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault()
                const step = event.key === 'ArrowLeft' ? -KEYBOARD_STEP : KEYBOARD_STEP
                setBankPercent((current) => clampPercent(current + step))
              }
            }}
          />
        </>
      )}
      <div className="editor-output">{examDraft}</div>
    </div>
  )
}

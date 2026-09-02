// The resizable split the authoring workspace is laid out in.
//
// The Question Bank opens as the narrower pane. It is a place to pick from
// rather than a place to read, so the sheet — which has a real printable width
// and cannot be scaled to fit without lying about what will print — gets the
// larger share, and the teacher moves the divider when they want more of the
// bank.
//
// The width lives here and nowhere else. It is a view of the workspace, not
// authoring data: it never reaches the store, never dirties the exam, never
// enters undo history and is gone on reload — the same rule the bank's search,
// filters and row selection already follow.

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

const DEFAULT_BANK_PERCENT = 33
// Neither pane is allowed to become a sliver: past these the divider is no
// longer resizing a split, it is collapsing one side without saying so.
const MIN_BANK_PERCENT = 20
const MAX_BANK_PERCENT = 80
/** How much one arrow-key press moves the divider. */
const KEYBOARD_STEP = 4

const clampPercent = (percent: number) =>
  Math.min(MAX_BANK_PERCENT, Math.max(MIN_BANK_PERCENT, percent))

export function WorkspaceSplit({
  bank,
  examDraft,
}: {
  bank: ReactNode
  examDraft: ReactNode
}) {
  const [bankPercent, setBankPercent] = useState(DEFAULT_BANK_PERCENT)
  const container = useRef<HTMLDivElement>(null)

  const resizeTo = useCallback((clientX: number) => {
    const bounds = container.current?.getBoundingClientRect()
    if (!bounds || bounds.width === 0) return
    setBankPercent(clampPercent(((clientX - bounds.left) / bounds.width) * 100))
  }, [])

  const dragging = useRef<number | null>(null)

  const style = {
    '--bank-column': `${bankPercent}%`,
  } as CSSProperties

  return (
    <div className="authoring-workspace" ref={container} style={style}>
      {bank}
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
      <div className="editor-output">{examDraft}</div>
    </div>
  )
}

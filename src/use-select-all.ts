// The Cmd/Ctrl-A listener for one selectable pane. `select-all.ts` decides
// which pane a press belongs to; this tracks what it decides from and stands
// aside whenever the key is someone else's:
//
// - typing — an input, textarea, select or contenteditable (the Milkdown
//   editor, a heading or header line) keeps select-all for its own text;
// - a modal dialog the pane is not inside, such as the Question editor;
// - an inert pane, as both are while Export History is being browsed.

import { useEffect, useRef, type RefObject } from 'react'
import { distinctIds, isSelectAllKey, selectAllPane, type SelectAllPane } from './select-all'

const PANE_ATTRIBUTE = 'data-select-all-pane'

// Module-wide because the choice is between panes: each pane's listener has to
// see the same answer. One document, so one record of each.
const mounted: SelectAllPane[] = []
let lastTouched: SelectAllPane | null = null
let tracking = 0

const touch = (event: Event) => {
  const pane = (event.target as Element | null)?.closest?.(`[${PANE_ATTRIBUTE}]`)
  const name = pane?.getAttribute(PANE_ATTRIBUTE)
  if (name === 'question-bank' || name === 'exam-draft') lastTouched = name
}

function isTyping(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  return element.isContentEditable || element.closest('input, textarea, select') !== null
}

/** Spread onto the pane's root element. */
export function selectAllPaneProps(pane: SelectAllPane) {
  return { [PANE_ATTRIBUTE]: pane }
}

export function useSelectAll(
  pane: SelectAllPane,
  root: RefObject<HTMLElement | null>,
  orderedIds: readonly string[],
  onSelectAll: (orderedIds: readonly string[]) => void,
) {
  // Read at key time, so the listener need not be replaced on every render.
  const latest = useRef({ orderedIds, onSelectAll })
  useEffect(() => {
    latest.current = { orderedIds, onSelectAll }
  })

  useEffect(() => {
    mounted.push(pane)
    if (tracking++ === 0) {
      document.addEventListener('pointerdown', touch, true)
      document.addEventListener('focusin', touch, true)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isSelectAllKey(event)) return
      if (selectAllPane(mounted, lastTouched) !== pane) return
      if (isTyping(event.target as Element | null) || isTyping(document.activeElement)) return
      const element = root.current
      if (!element || element.closest('[inert]')) return
      const modals = [...document.querySelectorAll('[aria-modal="true"]')]
      if (modals.some((modal) => !modal.contains(element))) return
      // Taken even with nothing to select: the browser's own select-all would
      // highlight the page chrome, which is never what was meant here.
      event.preventDefault()
      latest.current.onSelectAll(distinctIds(latest.current.orderedIds))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      mounted.splice(mounted.indexOf(pane), 1)
      if (--tracking === 0) {
        document.removeEventListener('pointerdown', touch, true)
        document.removeEventListener('focusin', touch, true)
        lastTouched = null
      }
    }
  }, [pane, root])
}

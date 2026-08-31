// Question selection: click to select, Cmd/Ctrl-click to toggle, Shift-click
// to extend a range, clear on background click or Escape.
//
// This is its own hook — not folded into `ExamPage` — because selection drives
// both page chrome and selection-wide actions. `App` owns one instance and
// passes it down so every interaction reads the same selected ids and anchor.

import { useCallback, useRef, useState } from 'react'

export type ClickModifiers = {
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}

export type Selection = {
  selectedIds: ReadonlySet<string>
  isSelected: (questionId: string) => boolean
  /**
   * A click on a question, given the ids in on-page order (so Shift-click can
   * compute a range) and which modifiers were held.
   */
  selectOne: (
    questionId: string,
    orderedIds: readonly string[],
    modifiers: ClickModifiers,
  ) => void
  /** The hover checkbox: always toggles, regardless of modifiers. */
  toggle: (questionId: string) => void
  clear: () => void
}

export function useSelection(): Selection {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  // The last question explicitly clicked (not Shift-clicked), so a Shift-click
  // has somewhere to extend a range from.
  const anchor = useRef<string | null>(null)

  const selectOne = useCallback(
    (questionId: string, orderedIds: readonly string[], modifiers: ClickModifiers) => {
      if (modifiers.shiftKey && anchor.current) {
        const from = orderedIds.indexOf(anchor.current)
        const to = orderedIds.indexOf(questionId)
        if (from !== -1 && to !== -1) {
          const [start, end] = from <= to ? [from, to] : [to, from]
          setSelectedIds(new Set(orderedIds.slice(start, end + 1)))
          return
        }
      }
      if (modifiers.metaKey || modifiers.ctrlKey) {
        setSelectedIds((previous) => {
          const next = new Set(previous)
          if (next.has(questionId)) next.delete(questionId)
          else next.add(questionId)
          return next
        })
        anchor.current = questionId
        return
      }
      setSelectedIds(new Set([questionId]))
      anchor.current = questionId
    },
    [],
  )

  const toggle = useCallback((questionId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(questionId)) next.delete(questionId)
      else next.add(questionId)
      return next
    })
    anchor.current = questionId
  }, [])

  const clear = useCallback(() => {
    setSelectedIds(new Set())
    anchor.current = null
  }, [])

  const isSelected = useCallback(
    (questionId: string) => selectedIds.has(questionId),
    [selectedIds],
  )

  return { selectedIds, isSelected, selectOne, toggle, clear }
}

// Question selection: click to select, Cmd/Ctrl-click to toggle, Shift-click
// to extend a range, Select All within a section, clear on background click.
//
// This is its own hook — not folded into `ExamPage`'s props — because #11
// adds a toolbar column control that also acts on "whatever is selected".
// Whoever owns this hook owns the seam both controls read: instantiate it
// once (in `App`, alongside the store), pass the returned `Selection` down to
// `ExamPage` for rendering checkboxes and outlines, and read
// `selection.selectedIds` directly wherever a toolbar action needs to know
// the current selection — no prop drilling through `ExamPage` required for
// that part.

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
  /** Select All within a section: replaces the selection with exactly these ids. */
  selectAll: (questionIds: readonly string[]) => void
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

  const selectAll = useCallback((questionIds: readonly string[]) => {
    setSelectedIds(new Set(questionIds))
  }, [])

  const clear = useCallback(() => {
    setSelectedIds(new Set())
    anchor.current = null
  }, [])

  const isSelected = useCallback(
    (questionId: string) => selectedIds.has(questionId),
    [selectedIds],
  )

  return { selectedIds, isSelected, selectOne, toggle, selectAll, clear }
}

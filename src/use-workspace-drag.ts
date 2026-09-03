// One drag gesture, across both panes of the authoring workspace.
//
// Dragging spans the Question Bank and the Exam Draft, so the gesture cannot
// belong to either of them: this is the coordinator both panes share. A pane
// says what a gesture is carrying and hands over the elements to draw; this
// finds what is under the pointer, asks `workspace-drag.ts` what releasing
// there would mean, and — on release — makes exactly one call to the store.
//
// Pointer capture, not native HTML drag-and-drop. `dragstart` surrenders the
// system cursor and the drag image to the browser, which then ignores even a
// computed `cursor: grabbing`; a captured pointer plus a page-owned preview
// keeps the closed hand, the exact source markup and the grab offset. That is
// the behaviour the Exam Draft already had, and it is preserved here rather
// than replaced.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  dropIntent,
  type DragSource,
  type DropCandidate,
  type DropIntent,
} from './workspace-drag'
import type { QuestionType } from './exam'

/** What a pane hands over when a gesture passes its movement threshold. */
export type DragGesture = {
  /** The elements the page-owned preview is cloned from. */
  elements: readonly HTMLElement[]
  /** The box the gesture was lifted from: the preview's size and its origin. */
  bounds: DOMRect
  /** Where the pointer went down, so the preview keeps its grab offset. */
  point: { x: number; y: number }
}

export type WorkspaceDrag = {
  /** What is being dragged, if anything. Rendering reads this to know a
   *  gesture is in flight and which Question Section it can reach. */
  source: DragSource | null
  /** What releasing now would do — and what the workspace draws. */
  intent: DropIntent | null
  /** Lifted questions, dimmed in place while the preview follows the pointer. */
  draggedQuestionIds: ReadonlySet<string>
  /** What a completed reorder moved: feedback belongs to the question that
   *  moved, not to whichever one is under the stationary pointer. */
  droppedQuestionIds: ReadonlySet<string>
  clearDropFeedback: () => void
  begin: (source: DragSource, gesture: DragGesture) => void
  move: (point: { x: number; y: number }) => void
  drop: () => void
  cancel: () => void
}

/** How a rendered question and an empty Question Section announce themselves to
 *  a gesture. Kept next to the reader so the two cannot drift. */
export const DROP_TARGET_SELECTOR = '.exam-question[data-drop-target]'
export const EMPTY_SECTION_SELECTOR = '[data-empty-section]'

/** What the pointer is over, read out of the real page. */
function candidateAt(point: { x: number; y: number }): DropCandidate | null {
  const element = document.elementFromPoint(point.x, point.y)
  if (!element) return null
  const emptySection = element.closest<HTMLElement>(EMPTY_SECTION_SELECTOR)
  if (emptySection?.dataset.emptySection) {
    return {
      kind: 'empty-section',
      section: emptySection.dataset.emptySection as QuestionType,
    }
  }
  const question = element.closest<HTMLElement>(DROP_TARGET_SELECTOR)
  const questionId = question?.dataset.questionId
  const type = question?.dataset.dropTarget
  if (!question || !questionId || !type) return null
  const bounds = question.getBoundingClientRect()
  return {
    kind: 'question',
    questionId,
    type: type as QuestionType,
    top: bounds.top,
    height: bounds.height,
  }
}

function sameIntent(a: DropIntent | null, b: DropIntent | null): boolean {
  if (a === b) return true
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'insert' && b.kind === 'insert') {
    return a.targetQuestionId === b.targetQuestionId && a.placement === b.placement
  }
  if (a.kind === 'replace' && b.kind === 'replace') {
    return a.outgoingQuestionId === b.outgoingQuestionId
  }
  return true
}

/** What the preview says it would do, in the teacher's words. An invalid
 *  target says nothing: the cursor already says it, and a label reading "no"
 *  over every incompatible question would be noise. */
function intentLabel(intent: DropIntent | null): string {
  if (!intent) return ''
  if (intent.kind === 'replace') return 'Replace'
  return 'Insert'
}

/** The page-owned counterpart to the browser's drag image: the real markup,
 *  cloned, stripped of the attributes that would make a copy answer as a drop
 *  target or duplicate an element id. */
function createPreview(gesture: DragGesture, source: DragSource): HTMLElement {
  const preview = document.createElement('div')
  preview.className = 'question-drag-preview'
  preview.setAttribute('aria-hidden', 'true')
  preview.setAttribute('inert', '')
  preview.dataset.pane = source.pane
  preview.dataset.count = String(gesture.elements.length)
  for (const element of gesture.elements) {
    const clone = element.cloneNode(true) as HTMLElement
    clone.classList.remove(
      'exam-question--selected',
      'exam-question--dragging',
      'exam-question--dropped',
    )
    clone.removeAttribute('data-question-id')
    clone.removeAttribute('data-drop-target')
    clone.removeAttribute('data-drop')
    clone.removeAttribute('aria-current')
    clone.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'))
    preview.append(clone)
  }
  const computed = getComputedStyle(gesture.elements[0] ?? document.body)
  Object.assign(preview.style, {
    left: `${gesture.bounds.left}px`,
    top: `${gesture.bounds.top}px`,
    width: `${gesture.bounds.width}px`,
    color: computed.color,
    fontFamily: computed.fontFamily,
    fontSize: computed.fontSize,
    lineHeight: computed.lineHeight,
  })
  return preview
}

export function useWorkspaceDrag(
  onDrop: (source: DragSource, intent: DropIntent) => void,
): WorkspaceDrag {
  // The gesture is held in refs as well as state: pointer events fire far more
  // often than a render is worth, and `drop` has to read the very latest
  // decision rather than whatever the last commit happened to paint.
  const sourceRef = useRef<DragSource | null>(null)
  const intentRef = useRef<DropIntent | null>(null)
  const preview = useRef<{
    element: HTMLElement
    offsetX: number
    offsetY: number
  } | null>(null)
  const [source, setSource] = useState<DragSource | null>(null)
  const [intent, setIntent] = useState<DropIntent | null>(null)
  const [droppedQuestionIds, setDroppedQuestionIds] = useState<ReadonlySet<string>>(
    new Set(),
  )

  const clearArtifacts = useCallback(() => {
    preview.current?.element.remove()
    preview.current = null
    const root = document.documentElement
    root.classList.remove('question-drag-active')
    delete root.dataset.dragPane
    delete root.dataset.dragSection
    delete root.dataset.dragIntent
  }, [])

  // A gesture that outlives its component would leave the cursor stuck in a
  // closed hand over a page that is no longer dragging anything.
  useEffect(() => clearArtifacts, [clearArtifacts])

  const paint = useCallback((next: DropIntent | null) => {
    intentRef.current = next
    document.documentElement.dataset.dragIntent = next ? next.kind : 'none'
    if (preview.current) {
      preview.current.element.dataset.intent = next ? next.kind : 'none'
      preview.current.element.dataset.intentLabel = intentLabel(next)
    }
    // Pointer movement is continuous; only a change in what would happen is
    // worth a re-render.
    setIntent((current) => (sameIntent(current, next) ? current : next))
  }, [])

  const begin = useCallback(
    (nextSource: DragSource, gesture: DragGesture) => {
      clearArtifacts()
      const element = createPreview(gesture, nextSource)
      document.body.append(element)
      const root = document.documentElement
      root.classList.add('question-drag-active')
      root.dataset.dragPane = nextSource.pane
      // The Question Section the gesture can reach, so compatible positions can
      // announce themselves before the pointer is over one.
      root.dataset.dragSection = nextSource.type
      // Where the preview sits under the pointer. A reorder keeps the grab
      // offset, so the question stays exactly where it was picked up and the
      // gesture reads as moving the thing itself. A bank row is instead
      // carried centred on the pointer: it is a different width from the
      // position it is aimed at, so honouring the grab offset would leave the
      // card hanging off to one side of the cursor and make the teacher aim
      // with an edge they cannot see.
      const centred = nextSource.pane === 'question-bank'
      preview.current = {
        element,
        offsetX: centred
          ? gesture.bounds.width / 2
          : gesture.point.x - gesture.bounds.left,
        offsetY: centred
          ? gesture.bounds.height / 2
          : gesture.point.y - gesture.bounds.top,
      }
      sourceRef.current = nextSource
      setSource(nextSource)
      setDroppedQuestionIds(new Set())
      paint(null)
    },
    [clearArtifacts, paint],
  )

  const move = useCallback(
    (point: { x: number; y: number }) => {
      const held = preview.current
      if (held) {
        held.element.style.left = `${point.x - held.offsetX}px`
        held.element.style.top = `${point.y - held.offsetY}px`
      }
      const current = sourceRef.current
      if (!current) return
      paint(dropIntent(current, candidateAt(point), point.y))
    },
    [paint],
  )

  const finish = useCallback(() => {
    sourceRef.current = null
    intentRef.current = null
    clearArtifacts()
    setSource(null)
    setIntent(null)
  }, [clearArtifacts])

  const drop = useCallback(() => {
    const current = sourceRef.current
    const landing = intentRef.current
    finish()
    if (!current || !landing) return
    onDrop(current, landing)
    // Feedback for a reorder belongs to the questions that moved. A
    // composition's incoming question is revealed and highlighted instead,
    // because it may not have been on the page at all a moment ago.
    if (current.pane === 'exam-draft') {
      setDroppedQuestionIds(new Set(current.questionIds))
    }
  }, [finish, onDrop])

  const clearDropFeedback = useCallback(() => setDroppedQuestionIds(new Set()), [])

  return {
    source,
    intent,
    draggedQuestionIds:
      source?.pane === 'exam-draft' ? new Set(source.questionIds) : EMPTY,
    droppedQuestionIds,
    clearDropFeedback,
    begin,
    move,
    drop,
    cancel: finish,
  }
}

const EMPTY: ReadonlySet<string> = new Set()

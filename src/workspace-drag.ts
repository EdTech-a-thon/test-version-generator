// What a drag gesture across the authoring workspace means.
//
// One gesture spans two panes. A Question Bank question is *composed* onto the
// Working Copy; a Working Copy question is *reordered* within it. Either way a
// drop only ever Inserts: before or after a rendered question, or — for the
// first question of a Question Section the exam has none of — into that
// section. Replacing is a row-menu command, not something a gesture can do by
// landing in the wrong band of a question.
//
// Both are constrained the same way. A Question Section boundary is fixed, so a
// Multiple Choice question only ever reaches a Multiple Choice position and a
// Short Answer question only ever reaches a Short Answer one.
//
// And a drop is never aimed. Released anywhere over the Working Copy, a gesture
// lands at the legal insertion line nearest the pointer — so a Short Answer
// question flicked onto the Multiple Choice section goes to the top of the
// Short Answer section, because that is the closest place it can go. The only
// release that changes nothing is one outside the Working Copy, which is how a
// gesture is abandoned.
//
// This is the whole of the geometry, kept pure and away from the DOM so the
// rule can be read and tested on its own. `use-workspace-drag.ts` is what
// reads the rendered questions out of the real page and turns an intent into
// exactly one call to the store.

import type { QuestionPlacement, QuestionType } from './exam'

/** Where a drag started, and what it is carrying. */
export type DragSource =
  | {
      pane: 'question-bank'
      /** The unused Question Bank records being composed onto the Working Copy,
       *  in the order they appeared in the filtered bank. A single-row drag
       *  carries a one-item list through this same boundary. */
      questionIds: readonly string[]
      type: QuestionType
    }
  | {
      pane: 'exam-draft'
      /** Every question the gesture picked up — a selection moves together. */
      questionIds: readonly string[]
      type: QuestionType
    }

/** A horizontal insertion line, in viewport coordinates. */
export type DropEdge = { y: number; left: number; right: number }

/** A rendered question as a gesture sees it: the line above it and the line
 *  below it. A question split across sheets has its `before` edge on its first
 *  piece and its `after` edge on its last. */
export type DropCandidate = {
  questionId: string
  type: QuestionType
  before: DropEdge
  after: DropEdge
}

/** What releasing now would do — and, equally, what the workspace draws.
 *  `null` is a release that changes nothing. */
export type DropIntent =
  | { kind: 'insert'; targetQuestionId: string; placement: QuestionPlacement }
  | { kind: 'insert-first' }

/** What one rendered question draws while a gesture is in flight: an insertion
 *  line on one of its edges, or nothing. */
export type QuestionDropState = QuestionPlacement | null

/** The intent as the question it names should draw it. Every other question on
 *  the page draws nothing. */
export function dropStateOf(
  intent: DropIntent | null,
  questionId: string,
): QuestionDropState {
  return intent?.kind === 'insert' && intent.targetQuestionId === questionId
    ? intent.placement
    : null
}

/** How far the pointer is from an insertion line: straight up or down when it
 *  is over the line's span, and to the line's nearer end when it is beside it. */
function distanceTo(edge: DropEdge, point: { x: number; y: number }): number {
  const dx = Math.max(edge.left - point.x, 0, point.x - edge.right)
  return Math.hypot(dx, point.y - edge.y)
}

/**
 * Where releasing at `point` would land.
 *
 * `candidates` is every rendered question on the Working Copy, in page order.
 * `point` is `null` when the pointer is not over the Working Copy at all.
 */
export function dropIntent(
  source: DragSource,
  candidates: readonly DropCandidate[],
  point: { x: number; y: number } | null,
): DropIntent | null {
  if (!point) return null

  // A question cannot be placed relative to itself, and a gesture carrying
  // several cannot be placed relative to any of its own members.
  const reachable = candidates.filter(
    (candidate) =>
      candidate.type === source.type && !source.questionIds.includes(candidate.questionId),
  )

  if (reachable.length === 0) {
    // A Question Section the exam has none of is not drawn on the sheet, so
    // there is no line to aim at: the whole Working Copy is the target. A
    // reorder never gets here usefully — a question already on the Working
    // Copy is already in its own section.
    const sectionIsEmpty = !candidates.some((candidate) => candidate.type === source.type)
    return source.pane === 'question-bank' && sectionIsEmpty ? { kind: 'insert-first' } : null
  }

  let nearest: DropIntent | null = null
  let nearestDistance = Infinity
  for (const candidate of reachable) {
    for (const placement of ['before', 'after'] as const) {
      const distance = distanceTo(candidate[placement], point)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = { kind: 'insert', targetQuestionId: candidate.questionId, placement }
      }
    }
  }
  return nearest
}

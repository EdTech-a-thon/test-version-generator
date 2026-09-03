// What a drag gesture across the authoring workspace means.
//
// One gesture spans two panes, and where it started decides what it can do.
// A Question Bank question is *composed* onto the Exam Draft: it can be
// Inserted before or after a rendered question, or Replace one outright. An
// Exam Draft question is *reordered*: before or after, and nothing else, because
// the pane a gesture starts in is what gives it its meaning.
//
// Both are constrained the same way. A Question Section boundary is fixed, so a
// Multiple Choice question only ever reaches a Multiple Choice position and a
// Short Answer question only ever reaches a Short Answer one. A gesture with
// nowhere legal to land resolves to no intent at all, which is what "an
// incompatible target exposes no active drop state" means: there is nothing to
// draw, and releasing changes nothing.
//
// This is the whole of the geometry, kept pure and away from the DOM so the
// rule can be read and tested on its own. `use-workspace-drag.ts` is what
// finds a candidate under a real pointer and turns an intent into exactly one
// call to the store.

import type { QuestionPlacement, QuestionType } from './exam'

/** Where a drag started, and what it is carrying. */
export type DragSource =
  | {
      pane: 'question-bank'
      /** The unused Question Bank record being composed onto the Exam Draft. */
      questionId: string
      type: QuestionType
    }
  | {
      pane: 'exam-draft'
      /** Every question the gesture picked up — a selection moves together. */
      questionIds: readonly string[]
      type: QuestionType
    }

/** What the pointer is currently over: a rendered question, with the geometry
 *  that decides which of its zones the pointer is in, or the standing offer to
 *  put the first question into an empty Question Section. */
export type DropCandidate =
  | {
      kind: 'question'
      questionId: string
      type: QuestionType
      /** Viewport coordinates, as `getBoundingClientRect` reports them. */
      top: number
      height: number
    }
  | { kind: 'empty-section'; section: QuestionType }

/** What releasing here would do — and, equally, what the workspace draws while
 *  the pointer is there. `null` is a target that is not one. */
export type DropIntent =
  | { kind: 'insert'; targetQuestionId: string; placement: QuestionPlacement }
  | { kind: 'replace'; outgoingQuestionId: string }
  | { kind: 'insert-first' }

/** What one rendered question draws while a gesture is over it: an insertion
 *  line on the edge the pointer is nearest, or the mark that the whole of it
 *  is the question being Replaced. `null` is a question with nothing to say. */
export type QuestionDropState = 'before' | 'after' | 'replace' | null

/** The intent as the question it names should draw it. Every other question on
 *  the page draws nothing, which is what an incompatible target amounts to. */
export function dropStateOf(
  intent: DropIntent | null,
  questionId: string,
): QuestionDropState {
  if (intent?.kind === 'insert') {
    return intent.targetQuestionId === questionId ? intent.placement : null
  }
  if (intent?.kind === 'replace') {
    return intent.outgoingQuestionId === questionId ? 'replace' : null
  }
  return null
}

// How deep a question's Insert edges are: enough of a band to aim at, but
// bounded, so that a question filling most of a sheet still Replaces across
// nearly all of itself rather than giving a third of the page away to each
// edge. Below 120px the fraction governs, so a short question keeps all three
// zones in proportion.
const EDGE_FRACTION = 0.3
const MAX_EDGE_DEPTH = 36

function edgeDepth(height: number): number {
  return Math.min(height * EDGE_FRACTION, MAX_EDGE_DEPTH)
}

/** Whether this source can act on this Question Section at all. */
function sameSection(source: DragSource, section: QuestionType): boolean {
  return source.type === section
}

export function dropIntent(
  source: DragSource,
  candidate: DropCandidate | null,
  pointerY: number,
): DropIntent | null {
  if (!candidate) return null

  if (candidate.kind === 'empty-section') {
    // Reordering cannot reach an empty Question Section: a question that is
    // already on the Exam Draft is already in its own section, and moving it
    // would be a change of type rather than a change of place.
    if (source.pane !== 'question-bank') return null
    return sameSection(source, candidate.section) ? { kind: 'insert-first' } : null
  }

  if (!sameSection(source, candidate.type)) return null

  if (source.pane === 'exam-draft') {
    // A question cannot be dropped onto itself, and a multi-question gesture
    // cannot be dropped onto any of its own members.
    if (source.questionIds.includes(candidate.questionId)) return null
    return {
      kind: 'insert',
      targetQuestionId: candidate.questionId,
      placement:
        pointerY < candidate.top + candidate.height / 2 ? 'before' : 'after',
    }
  }

  const edge = edgeDepth(candidate.height)
  if (pointerY < candidate.top + edge) {
    return { kind: 'insert', targetQuestionId: candidate.questionId, placement: 'before' }
  }
  if (pointerY > candidate.top + candidate.height - edge) {
    return { kind: 'insert', targetQuestionId: candidate.questionId, placement: 'after' }
  }
  return { kind: 'replace', outgoingQuestionId: candidate.questionId }
}

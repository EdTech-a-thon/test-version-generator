// The exam sheet's type, one table for every adapter.
//
// Print is the reference presentation, so these are the CSS pixel sizes
// `styles.css` gives `.exam-page` and its furniture; `export-typography.test.ts`
// holds the stylesheet to them. The PDF draws them at the page's own 0.75pt per
// px. Word sizes type in whole half-points, so DOCX takes the half-point at or
// below each size: never larger than the text the plan measured, and never more
// than a quarter point smaller.

export const EXAM_FONT = 'Georgia'

export const EXAM_TYPE_PX = {
  /** `.exam-page`: stems, choices, prompts, instructions, the identity line. */
  body: 15,
  /** `.exam-title` on a first page. */
  title: 26,
  /** `.section-title` and `.answer-key-section`. */
  sectionTitle: 17,
  /** `.answer-key-heading`: the key's "Answer Section". */
  answerKeyHeading: 20,
  /** `.page-footer` and `.doc-figure figcaption`. */
  small: 13,
} as const

export type ExamTypeRole = keyof typeof EXAM_TYPE_PX

const POINTS_PER_PX = 0.75

/** A role's size in PDF points. */
export function pointsOf(role: ExamTypeRole): number {
  return EXAM_TYPE_PX[role] * POINTS_PER_PX
}

/** A role's size in Word half-points, rounded down to a whole one. */
export function halfPointsOf(role: ExamTypeRole): number {
  return Math.floor(pointsOf(role) * 2)
}

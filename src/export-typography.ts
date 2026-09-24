// The exam sheet's type, one table for every adapter.
//
// Print is the reference presentation, so these are the CSS pixel sizes
// `styles.css` gives `.exam-page` and its furniture; `export-typography.test.ts`
// holds the stylesheet to them. The PDF draws them at the page's own 0.75pt per
// px. Word sizes type in whole half-points, so DOCX takes the half-point at or
// below each size: never larger than the text the plan measured, and never more
// than a quarter point smaller.

import type { HeadingSize } from './section-headings'

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

/** A section heading and its directions, at each size an Exam can print its
 *  headings. `'normal'` is the sheet's own type, so an Exam that never chose a
 *  size prints exactly as before. */
export const SECTION_HEADING_PX: Record<HeadingSize, { title: number; instructions: number }> = {
  small: { title: 15, instructions: 13 },
  normal: { title: EXAM_TYPE_PX.sectionTitle, instructions: EXAM_TYPE_PX.body },
  large: { title: 21, instructions: 17 },
}

/** A section heading's sizes in PDF points. */
export function sectionHeadingPoints(size: HeadingSize = 'normal'): { title: number; instructions: number } {
  const px = SECTION_HEADING_PX[size]
  return { title: px.title * POINTS_PER_PX, instructions: px.instructions * POINTS_PER_PX }
}

/** A section heading's sizes in Word half-points, rounded down like the rest. */
export function sectionHeadingHalfPoints(size: HeadingSize = 'normal'): { title: number; instructions: number } {
  const points = sectionHeadingPoints(size)
  return { title: Math.floor(points.title * 2), instructions: Math.floor(points.instructions * 2) }
}

/** The inline type a section heading prints at in print, on an Exam that chose
 *  a size; nothing at all for `'normal'`, which the stylesheet already says. */
export function sectionHeadingStyles(size: HeadingSize | undefined): {
  title?: { fontSize: number }
  instructions?: { fontSize: number }
} {
  if (!size || size === 'normal') return {}
  const px = SECTION_HEADING_PX[size]
  return { title: { fontSize: px.title }, instructions: { fontSize: px.instructions } }
}

// The real `Measure` the app hands to `renderExam`, as opposed to the stubs
// tests inject (see `exam-render.ts`'s `unmeasured` and the hand-built
// `Measure`s in `exam-render.test.ts`).
//
// `choiceWidth` (#11) is real: it asks a detached `<canvas>` for the width a
// choice's text would take on one line, using the same font the choice grid
// prints in. A canvas measurement needs no element mounted in the live DOM,
// which is why this can be a plain module-level singleton rather than
// something a component has to construct and hold onto.
//
// `itemHeight` (#7's seam) is still the stub — 0 for everything, same as
// `unmeasured` — because measuring a page item's height means laying out its
// actual rendered content (rich text, images, a choice grid) at the content
// box's width, which canvas text metrics can't do. That half belongs in this
// file too: replace the `itemHeight` below with something that mounts (or
// reuses) an off-screen container sized to the page's content width — see
// `PAGE_CONTENT_WIDTH` in `exam-render.ts`, which `itemHeight` will need
// alongside a content-height counterpart — renders the `PageItem` into it
// (the same views `exam-page.tsx` uses on-screen: `DocView` for a stem or
// choice body, `ChoiceGridView`'s markup for a grid), and reads back
// `scrollHeight`. Keeping both functions in one `Measure` here, rather than
// splitting real measurement across two places, is what "slots in alongside"
// means: `domMeasure` stays the single real implementation `exam-page.tsx`
// imports, before and after #7 lands.

import type { Choice } from './exam'
import type { Measure } from './exam-render'
import type { ProseMirrorJSON } from './question-doc'

// Matches `.choice-body` in styles.css (inherited from `.exam-page`'s
// `font-family` and `font-size`).
const CHOICE_FONT = '15px Georgia, "Times New Roman", serif'

// Rough allowance, in px, for what sits alongside a choice's text on its
// line: the letter prefix (`.choice-letter`, e.g. "A.") plus its margin, and
// the cell's own right padding (`.choice-cell`). Not exact — real DOM
// measurement is deliberately untested — just enough that a choice isn't
// judged to fit a column it would actually wrap in.
const CHOICE_PREFIX_ALLOWANCE = 30

let context: CanvasRenderingContext2D | null | undefined

// Lazy and cached: one detached canvas for the process, not one per call.
// `undefined` means "not looked up yet"; `null` means "looked up and there is
// no canvas" (a non-browser environment), so the lookup isn't retried.
function measureContext(): CanvasRenderingContext2D | null {
  if (context === undefined) {
    context =
      typeof document === 'undefined'
        ? null
        : document.createElement('canvas').getContext('2d')
  }
  return context
}

/** Every text node's contents, concatenated, depth-first. */
function textOf(node: ProseMirrorJSON): string {
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.content)) return ''
  return (node.content as ProseMirrorJSON[]).map(textOf).join('')
}

function choiceWidth(choice: Choice): number {
  const ctx = measureContext()
  if (!ctx) return 0
  ctx.font = CHOICE_FONT
  return ctx.measureText(textOf(choice.node)).width + CHOICE_PREFIX_ALLOWANCE
}

// `itemHeight` is the stub half of this `Measure` — see the file comment for
// exactly where #7 replaces it.
function itemHeight(): number {
  return 0
}

export const domMeasure: Measure = { choiceWidth, itemHeight }

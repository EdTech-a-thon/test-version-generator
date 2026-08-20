// The real `Measure` the app hands to `renderExam`, as opposed to the stubs
// tests inject (see `exam-render.ts`'s `unmeasured` and the hand-built
// `Measure`s in `exam-render.test.ts`). Both halves work the same way: ask the
// browser what the real thing comes out as, off-screen, and hand back a number.
//
// `choiceWidth` (#11) asks a detached `<canvas>` for the width a choice's text
// would take on one line, using the same font the choice grid prints in. A
// canvas measurement needs no element in the live DOM at all.
//
// `itemHeight` (#7) needs layout, not text metrics: a page item's height is the
// height of its rich text, its images and its choice grid once they are laid out
// at the page's content width. So it renders the item — through
// `PageItemMeasureView`, the very components `exam-page.tsx` draws on screen —
// into one reused off-screen host sized to `PAGE_CONTENT_WIDTH`, and measures
// the host.
//
// Two things about that host matter and are easy to undo by accident:
//
//   - It is `display: flow-root` (see `.measure-host` in styles.css), so a top
//     item margin is contained rather than collapsing out of the host and going
//     unmeasured.
//   - Page items must keep a zero top margin, since each one is measured alone
//     and the heights are then summed. Bottom margins are what separates them.
//
// This is the one place in the app that reads a layout property, and it is why
// `renderExam` never has to: everything downstream of `Measure` is arithmetic.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Choice } from './exam'
import { PAGE_CONTENT_WIDTH, type Measure, type PageItem } from './exam-render'
import { PageItemMeasureView } from './page-item-view'
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

let host: HTMLElement | null | undefined

// Lazy and cached, like the canvas above: one host for the process, appended
// once and reused for every measurement. It carries `.exam-page` so the item
// inherits exactly the typography it will print in; `.measure-host` overrides
// the page's own size and position and takes it out of sight.
function measureHost(): HTMLElement | null {
  if (host === undefined) {
    if (typeof document === 'undefined') {
      host = null
    } else {
      host = document.createElement('div')
      host.className = 'exam-page measure-host'
      host.setAttribute('aria-hidden', 'true')
      // From the same constant packing uses, so the width an item is measured
      // at is by construction the width it is packed against.
      host.style.width = `${PAGE_CONTENT_WIDTH}px`
      document.body.appendChild(host)
    }
  }
  return host
}

// Static markup rather than a React root: measurement is a synchronous question
// asked from inside another component's effect, and a second root rendering
// there would be fighting React's own scheduling for no gain — nothing in a
// measured item is interactive or stateful.
function itemHeight(item: PageItem): number {
  const element = measureHost()
  if (!element) return 0
  element.innerHTML = renderToStaticMarkup(createElement(PageItemMeasureView, { item }))
  // Fractional, unlike `scrollHeight`: the heights of a dozen items are summed
  // against a fixed box, and a rounded pixel each would be a rounded page.
  return element.getBoundingClientRect().height
}

export const domMeasure: Measure = { choiceWidth, itemHeight }

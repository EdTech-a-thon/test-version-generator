// The real `Measure` the app hands to `planExport`, as opposed to the stubs
// tests inject (see `export-plan.ts`'s `unmeasured` and the hand-built
// `Measure`s in `export-plan.test.ts`). Both halves work the same way: ask the
// browser what the real thing comes out as, off-screen, and hand back a number.
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
// `planExport` never has to: everything downstream of `Measure` is arithmetic.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PAGE_CONTENT_WIDTH, type Measure, type PageItem } from './export-plan'
import { PageItemMeasureView } from './page-item-view'

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

// Heights already found, keyed by the exact markup they were found for.
//
// The key is the rendered markup itself, which is the whole of what decides a
// height once the width and the typography are fixed — so a hit cannot be a
// wrong answer the way a hand-picked key (id, or content minus some field
// thought not to matter) could be.
//
// This is what makes reordering cheap. Shuffling or dragging changes which
// items sit where, not what any of them contains, so all but the handful whose
// printed number changed hit the cache and never touch layout at all.
const heights = new Map<string, number>()

// Big enough for a long exam's items several times over, small enough that an
// afternoon of editing cannot grow it without bound.
const HEIGHT_CACHE_LIMIT = 600

// Static markup rather than a React root: measurement is a synchronous question
// asked from inside another component's effect, and a second root rendering
// there would be fighting React's own scheduling for no gain — nothing in a
// measured item is interactive or stateful.
function itemHeight(item: PageItem): number {
  const element = measureHost()
  if (!element) return 0
  const markup = renderToStaticMarkup(createElement(PageItemMeasureView, { item }))
  const remembered = heights.get(markup)
  if (remembered !== undefined) return remembered
  element.innerHTML = markup
  // Fractional, unlike `scrollHeight`: the heights of a dozen items are summed
  // against a fixed box, and a rounded pixel each would be a rounded page.
  const height = element.getBoundingClientRect().height
  if (heights.size >= HEIGHT_CACHE_LIMIT) heights.clear()
  heights.set(markup, height)
  return height
}

// Throw the remembered heights away, for when the same markup would now measure
// differently: a web font has arrived, or an image has finished decoding and
// stopped measuring as nothing. Callers that re-measure on those events must
// call this first, or they will re-measure straight out of a stale cache.
function invalidate(): void {
  heights.clear()
}

export const domMeasure: Measure & { invalidate(): void } = {
  itemHeight,
  invalidate,
}

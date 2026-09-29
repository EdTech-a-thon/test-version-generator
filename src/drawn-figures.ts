import { isPicture, type PageBox } from './picture-rules'

/**
 * A picture drawn with lines rather than stored as an image: a graph or a
 * structure that a browser saved as a PDF keeps as the paths its SVG drew.
 * Nothing in the PDF says where such a picture is, so it is found from the
 * ink: paths that touch are one drawing, and a drawing big enough to be a
 * picture, with enough curves to be more than the ruled lines of a table or
 * a box, is a figure. Its words — axis labels, atom symbols — are text in
 * the PDF, so any short text sitting on a figure is taken into its box.
 */

/** One painted path: where it lands, and how many curve segments it has. */
export type DrawnPath = { box: PageBox; curves: number }

/** A path this wide is a rule across the page, such as a header's. */
const PAGE_RULE = 800
/** Paths this close are strokes of one drawing. */
const TOUCHING = 8
/** A table's borders and a box's corners are straight or have a few curves;
 *  the smallest figure measured had hundreds. */
const MIN_CURVES = 10

const overlaps = (a: PageBox, b: PageBox, gap = 0) =>
  a.left - gap < b.right && b.left - gap < a.right && a.top - gap < b.bottom && b.top - gap < a.bottom

const union = (a: PageBox, b: PageBox): PageBox => ({
  left: Math.min(a.left, b.left),
  top: Math.min(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.max(a.bottom, b.bottom),
})

/**
 * The figures drawn on a page, as boxes in no particular order. `text` is
 * where each run of the page's text lands, and `images` where its images are
 * painted: a drawing over an image is part of that image, not a figure.
 */
export function drawnFigures(
  paths: readonly DrawnPath[],
  text: readonly PageBox[],
  images: readonly PageBox[],
): PageBox[] {
  const drawings = paths
    .filter(({ box }) => box.right - box.left <= PAGE_RULE)
    .map(({ box, curves }) => ({ box: { ...box }, curves }))
  for (let merged = true; merged; ) {
    merged = false
    for (let i = 0; i < drawings.length && !merged; i += 1) {
      for (let j = i + 1; j < drawings.length; j += 1) {
        if (!overlaps(drawings[i]!.box, drawings[j]!.box, TOUCHING)) continue
        drawings[i] = {
          box: union(drawings[i]!.box, drawings[j]!.box),
          curves: drawings[i]!.curves + drawings[j]!.curves,
        }
        drawings.splice(j, 1)
        merged = true
        break
      }
    }
  }
  return drawings
    .filter(({ box, curves }) => curves >= MIN_CURVES && isPicture(box))
    .filter(({ box }) => !images.some((image) => overlaps(box, image)))
    .map(({ box }) => withLabels(box, text))
}

/** A figure grown by the text on it, until no more reaches it: tick labels
 *  first, then the axis title past them. */
function withLabels(drawing: PageBox, text: readonly PageBox[]): PageBox {
  // A line of the question running past the figure is not its label.
  let left = text.filter((words) => words.right - words.left <= drawing.right - drawing.left)
  let figure = drawing
  for (let grew = true; grew; ) {
    const reached = left.filter((words) => {
      const x = (words.left + words.right) / 2
      const y = (words.top + words.bottom) / 2
      return (
        x > figure.left - TOUCHING &&
        x < figure.right + TOUCHING &&
        y > figure.top - TOUCHING &&
        y < figure.bottom + TOUCHING
      )
    })
    grew = reached.length > 0
    figure = reached.reduce(union, figure)
    left = left.filter((words) => !reached.includes(words))
  }
  return figure
}

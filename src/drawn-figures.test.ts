import { describe, expect, test } from 'bun:test'
import { drawnFigures, type DrawnPath } from './drawn-figures'
import type { PageBox } from './picture-rules'

const box = (left: number, top: number, right: number, bottom: number): PageBox => ({ left, top, right, bottom })
const path = (left: number, top: number, right: number, bottom: number, curves = 0): DrawnPath => ({
  box: box(left, top, right, bottom),
  curves,
})

/** A graph: two axes and a curve, three paths that touch. */
const graph = (left: number, top: number): DrawnPath[] => [
  path(left, top + 150, left + 300, top + 152),
  path(left, top, left + 2, top + 150),
  path(left + 20, top + 10, left + 280, top + 140, 40),
]

describe('figures drawn with lines', () => {
  test('are the paths that touch, as one box', () => {
    expect(drawnFigures(graph(200, 100), [], [])).toEqual([box(200, 100, 500, 252)])
  })

  test('stay apart when their drawings do not touch', () => {
    expect(drawnFigures([...graph(200, 100), ...graph(200, 300)], [], [])).toHaveLength(2)
  })

  test('span a frame that only clips them', () => {
    // A browser clips an SVG to its frame: the frame paints nothing, and
    // counts as no curves, but the figure is as big as it.
    const frame = path(180, 80, 520, 300)
    expect(drawnFigures([...graph(200, 100), frame], [], [])).toEqual([box(180, 80, 520, 300)])
  })

  test('are not tables, boxes or rules, which are straight lines', () => {
    const table = [path(100, 500, 400, 530), path(100, 530, 400, 560), path(100, 560, 400, 590)]
    const rule = path(50, 950, 950, 952, 0)
    const roundedBox = path(100, 700, 400, 800, 4)
    expect(drawnFigures([...table, rule, roundedBox], [], [])).toEqual([])
  })

  test('are not too small to be a picture', () => {
    expect(drawnFigures([path(100, 100, 130, 110, 20)], [], [])).toEqual([])
  })

  test('are not lines drawn over an embedded image', () => {
    expect(drawnFigures(graph(200, 100), [], [box(190, 90, 510, 260)])).toEqual([])
  })

  test('take in the labels that sit on them, but not the question beside them', () => {
    const ticks = [box(215, 254, 225, 262), box(365, 254, 375, 262)]
    const axisTitle = box(300, 263, 400, 275)
    const sidewaysTitle = box(188, 150, 198, 220)
    const question = box(100, 85, 900, 97)
    expect(drawnFigures(graph(200, 100), [axisTitle, question, ...ticks, sidewaysTitle], [])).toEqual([
      box(188, 100, 500, 275),
    ])
  })
})

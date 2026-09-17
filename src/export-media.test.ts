import { describe, expect, test } from 'bun:test'
import { authoredImageRatio, authoredImageWidth } from './export-media'

describe('authoredImageRatio', () => {
  test('is the ratio Crepe recorded, or 1 when it recorded none it could use', () => {
    expect(authoredImageRatio({ ratio: 0.5 })).toBe(0.5)
    expect(authoredImageRatio({ ratio: 1.25 })).toBe(1.25)
    expect(authoredImageRatio({})).toBe(1)
    expect(authoredImageRatio({ ratio: 0 })).toBe(1)
    expect(authoredImageRatio({ ratio: -2 })).toBe(1)
    expect(authoredImageRatio({ ratio: Number.NaN })).toBe(1)
    expect(authoredImageRatio({ ratio: 'half' })).toBe(1)
  })
})

describe('authoredImageWidth', () => {
  // A 400px picture in a 600px column fits at 400; a 2000px one fits at 600.
  test('an untouched picture fits its column', () => {
    expect(authoredImageWidth(400, 600, 1)).toBe(400)
    expect(authoredImageWidth(2000, 600, 1)).toBe(600)
  })

  test('a picture dragged smaller is the size it fit at, scaled', () => {
    expect(authoredImageWidth(400, 600, 0.5)).toBe(200)
    expect(authoredImageWidth(2000, 600, 0.5)).toBe(300)
  })

  test('a picture dragged larger grows, but never past the column', () => {
    expect(authoredImageWidth(400, 600, 1.2)).toBe(480)
    expect(authoredImageWidth(400, 600, 2)).toBe(600)
    expect(authoredImageWidth(2000, 600, 1.5)).toBe(600)
  })
})

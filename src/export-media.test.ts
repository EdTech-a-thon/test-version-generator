import { describe, expect, test } from 'bun:test'
import { authoredImageRatio, authoredImageWidth, jpegOrientation } from './export-media'

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

// A JPEG as a phone camera writes one: start of image, an EXIF segment whose
// first IFD holds the Orientation tag, then the start of the scan.
function cameraJpeg(orientation: number | null, byteOrder: 'II' | 'MM' = 'MM', jfifFirst = false): Uint8Array {
  const little = byteOrder === 'II'
  const tiff = new DataView(new ArrayBuffer(26))
  tiff.setUint8(0, byteOrder.charCodeAt(0))
  tiff.setUint8(1, byteOrder.charCodeAt(1))
  tiff.setUint16(2, 42, little)
  tiff.setUint32(4, 8, little)
  tiff.setUint16(8, 1, little)
  // One IFD entry: Orientation, or an unrelated tag (ImageWidth) when none.
  tiff.setUint16(10, orientation === null ? 0x0100 : 0x0112, little)
  tiff.setUint16(12, 3, little)
  tiff.setUint32(14, 1, little)
  tiff.setUint16(18, orientation ?? 640, little)
  tiff.setUint32(22, 0, little)
  const exif = [...new TextEncoder().encode('Exif'), 0, 0, ...new Uint8Array(tiff.buffer)]
  const app1 = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff, ...exif]
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new TextEncoder().encode('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
  return Uint8Array.from([0xff, 0xd8, ...(jfifFirst ? app0 : []), ...app1, 0xff, 0xda, 0x00, 0x02])
}

describe('jpegOrientation', () => {
  // A browser draws and measures a camera JPEG turned the way its Orientation
  // tag says; PDF and Word embed the stored pixels as they are. A portrait
  // photo stored sideways came out of the PDF turned a quarter and stretched.
  test('reads a camera’s Orientation tag in either byte order', () => {
    expect(jpegOrientation(cameraJpeg(6, 'MM'))).toBe(6)
    expect(jpegOrientation(cameraJpeg(8, 'II'))).toBe(8)
    expect(jpegOrientation(cameraJpeg(3, 'MM', true))).toBe(3)
  })

  test('is upright for a JPEG with no Orientation tag, or none at all', () => {
    expect(jpegOrientation(cameraJpeg(1))).toBe(1)
    expect(jpegOrientation(cameraJpeg(null))).toBe(1)
    expect(jpegOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toBe(1)
  })

  test('is upright for bytes that are not a JPEG, or are cut short', () => {
    expect(jpegOrientation(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(1)
    expect(jpegOrientation(cameraJpeg(6).subarray(0, 12))).toBe(1)
    expect(jpegOrientation(new Uint8Array())).toBe(1)
  })
})

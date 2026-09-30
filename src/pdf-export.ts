// The PDF Export Adapter.
//
// It consumes retained Layout Plans exactly like the DOCX adapter: one PDF page
// per planned page, in selected-plan order, with no measurement or pagination.
// Text is emitted as font-backed PDF text, links as annotations, and Media
// Assets as image XObjects. Any content that would escape its planned content
// box stops publication instead of being clipped, shrunk, or repaginated.

import fontkit from '@pdf-lib/fontkit'
import {
  AFRelationship,
  appendBezierCurve,
  appendQuadraticCurve,
  clip,
  closePath,
  concatTransformationMatrix,
  endPath,
  fill,
  PDFArray,
  PDFDocument,
  PDFName,
  lineTo,
  moveTo,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingColor,
  setLineWidth,
  setStrokingColor,
  stroke,
  type Color,
  type PDFOperator,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib'
import { pictureKey, printedPictureWidth } from './picture-geometry'
import {
  browserMedia,
  missingPicture,
  loadExportImages,
  questionNumberForMedia,
  RequiredMediaError,
  type ExportImage,
  type MediaLoader,
} from './export-media'
import {
  MATCHING_BANK_WIDTH,
  PART_INDENT,
  printsNumberLine,
  questionIndentOf,
  MATCHING_INDENT,
  type AnswerKeyEntryItem,
  type ChoiceGrid,
  type LayoutPlan,
  type MatchingSet,
  type PlannedBankAnswer,
  type PageFurniture,
  type PageItem,
  type PlannedPart,
  type PlannedWorkSpace,
  type QuestionItem,
} from './export-plan'
import { DIFFICULTY_LABELS, WORK_SPACE_LINE_PITCH } from './exam'
import { bodyScale, pointsOf, sectionHeadingPoints, titlePoints } from './export-typography'
import type { ProseMirrorJSON } from './question-doc'
import { mathJaxTools } from './mathjax'
import {
  mathPieces as writtenMath,
  mathText,
  typesetMath,
  type PathStep,
  type TypesetMath,
} from './pdf-math'
import {
  QUESTION_BANK_ATTACHMENT_DESCRIPTION,
  QUESTION_BANK_ATTACHMENT_NAME,
} from './question-bank-export'

const PDF_MIME = 'application/pdf'
const POINTS_PER_PX = 0.75
// The sheet's own body type, which the header line and the section headings'
// ratios keep whatever the Exam's text size.
const SHEET_BODY_SIZE = pointsOf('body')
const SHEET_BODY_LINE = 16.3
// The body type the plan being drawn prints its content at: the sheet's own,
// scaled by the Exam's text size. Set for each plan in `createPdf`, whose
// drawing is synchronous, so no other export can see a plan's size.
let BODY_SIZE = SHEET_BODY_SIZE
let BODY_LINE = SHEET_BODY_LINE
const SMALL_SIZE = pointsOf('small')
/** KaTeX sets an equation at 1.21 times the size of the text around it. */
const MATH_SIZE = 1.21
const HEADING_SIZE = pointsOf('sectionTitle')
const ANSWER_KEY_HEADING_SIZE = pointsOf('answerKeyHeading')
const INK = rgb(0.2, 0.165, 0.14)
/** Where the key's answer column starts: past `.answer-key-entry`'s 42px
 *  number column and its 8px gap. */
const ANSWER_KEY_ANSWER_X = 38
const LINK = rgb(0.08, 0.3, 0.7)
const RULE = rgb(0.55, 0.5, 0.45)
const TAG_FILL = rgb(0.95, 0.91, 0.86)
const TAG_BORDER = rgb(0.82, 0.75, 0.66)
export type PdfFontStyle = 'regular' | 'bold' | 'italic' | 'boldItalic' | 'mono'
export type PdfFontLoader = (style: PdfFontStyle) => Promise<ArrayBuffer | Uint8Array>

export const browserPdfFonts: PdfFontLoader = async (style) => {
  const files: Record<PdfFontStyle, string> = {
    regular: '/fonts/FreeSerif.ttf',
    bold: '/fonts/FreeSerifBold.ttf',
    italic: '/fonts/FreeSerifItalic.ttf',
    boldItalic: '/fonts/FreeSerifBoldItalic.ttf',
    mono: '/fonts/FreeMono.ttf',
  }
  const response = await fetch(files[style])
  if (!response.ok) {
    throw new Error(`The bundled PDF font (${style}) could not be loaded. Try again.`)
  }
  return response.arrayBuffer()
}

export class PdfUnsupportedCharacterError extends Error {
  constructor(character: string) {
    const code = character.codePointAt(0)?.toString(16).toUpperCase() ?? 'unknown'
    super(
      `PDF export does not support the character “${character}” (U+${code}). `
      + 'Remove or replace it, then try exporting again.',
    )
    this.name = 'PdfUnsupportedCharacterError'
  }
}

export class PdfLayoutError extends Error {
  constructor(pageNumber: number) {
    super(
      `PDF content does not fit its planned page ${pageNumber}. `
      + 'Shorten the affected content or change its layout, then try again.',
    )
    this.name = 'PdfLayoutError'
  }
}

export function isPdfUnsupportedCharacterError(
  error: unknown,
): error is PdfUnsupportedCharacterError {
  return error instanceof PdfUnsupportedCharacterError
}

export function isPdfLayoutError(error: unknown): error is PdfLayoutError {
  return error instanceof PdfLayoutError
}

type EmbeddedFonts = {
  regular: PDFFont
  bold: PDFFont
  italic: PDFFont
  boldItalic: PDFFont
  mono: PDFFont
}

type DrawContext = {
  document: PDFDocument
  page: PDFPage
  fonts: EmbeddedFonts
  images: ReadonlyMap<string, { source: ExportImage; image: PDFImage }>
  x: number
  y: number
  width: number
  bottom: number
  pageNumber: number
  /** An equation typeset, or null when MathJax cannot typeset it. */
  typeset: (source: string, display: boolean) => TypesetMath | null
}

type InlinePiece = {
  text: string
  font: keyof EmbeddedFonts
  size: number
  href?: string
  rise?: number
  strike?: boolean
  /** The source of an inline equation, which `text` stands in for until the
   *  equation is typeset, */
  math?: string
  /** and the equation typeset. */
  typeset?: TypesetMath
}

function attrsOf(node: ProseMirrorJSON): Record<string, unknown> {
  return typeof node.attrs === 'object' && node.attrs !== null
    ? (node.attrs as Record<string, unknown>)
    : {}
}

function childrenOf(node: ProseMirrorJSON): ProseMirrorJSON[] {
  return Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
}

function stringOf(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function pt(px: number): number {
  return px * POINTS_PER_PX
}

function assertSupported(text: string, font: PDFFont): void {
  const supported = new Set(font.getCharacterSet())
  for (const character of text) {
    const codePoint = character.codePointAt(0)
    // Newlines are authored layout commands and are emitted as PDF line
    // changes, never encoded as glyphs in the font.
    if (character === '\n' || character === '\r') continue
    if (codePoint === undefined || !supported.has(codePoint)) {
      throw new PdfUnsupportedCharacterError(character)
    }
  }
}

function ensureRoom(context: DrawContext, height: number): void {
  if (context.y - height < context.bottom - 0.5) {
    throw new PdfLayoutError(context.pageNumber)
  }
}

function addLink(
  context: DrawContext,
  href: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (!href) return
  const annotation = context.document.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [x, y, x + width, y + height],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(href) },
  })
  const reference = context.document.context.register(annotation)
  let annotations = context.page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (!annotations) {
    annotations = context.document.context.obj([])
    context.page.node.set(PDFName.of('Annots'), annotations)
  }
  annotations.push(reference)
}

function textPieces(node: ProseMirrorJSON): InlinePiece[] {
  const pieces: InlinePiece[] = []
  const visit = (current: ProseMirrorJSON) => {
    if (current.type === 'text') {
      let font: keyof EmbeddedFonts = 'regular'
      let size = BODY_SIZE
      let href: string | undefined
      let rise = 0
      let strike = false
      let bold = false
      let italic = false
      for (const mark of (current.marks ?? []) as ProseMirrorJSON[]) {
        if (mark.type === 'strong') bold = true
        if (mark.type === 'emphasis') italic = true
        if (mark.type === 'inlineCode') font = 'mono'
        if (mark.type === 'link') href = stringOf(attrsOf(mark).href)
        if (mark.type === 'subscript') {
          size = BODY_SIZE * 0.75
          rise = -BODY_SIZE * 0.2
        }
        if (mark.type === 'superscript') {
          size = BODY_SIZE * 0.75
          rise = BODY_SIZE * 0.35
        }
        if (mark.type === 'strike_through') strike = true
      }
      if (font !== 'mono') {
        font = bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular'
      }
      pieces.push({ text: stringOf(current.text), font, size, href, rise, strike })
      return
    }
    if (current.type === 'hardbreak') {
      pieces.push({ text: '\n', font: 'regular', size: BODY_SIZE })
      return
    }
    if (current.type === 'math_inline') {
      pieces.push({ text: '', font: 'regular', size: BODY_SIZE, math: stringOf(attrsOf(current).value) })
      return
    }
    if (current.type === 'image') {
      pieces.push({ text: `\uFFFC${stringOf(attrsOf(current).src)}`, font: 'regular', size: BODY_SIZE })
      return
    }
    for (const child of childrenOf(current)) visit(child)
  }
  visit(node)
  return pieces
}

/** An equation written on the line as runs of text, for one MathJax cannot
 *  typeset: see `pdf-math.ts`. */
function writtenMathPieces(source: string, size: number): InlinePiece[] {
  return writtenMath(source).map((piece) => ({
    text: piece.text,
    font: 'regular',
    size: size * piece.scale,
    rise: size * piece.rise,
  }))
}

/** A named `\color`, or a hex one; anything else prints in ink. */
const MATH_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], green: [0, 0.5, 0],
  blue: [0, 0, 1], cyan: [0, 1, 1], magenta: [1, 0, 1], yellow: [1, 1, 0],
  orange: [1, 0.65, 0], purple: [0.5, 0, 0.5], brown: [0.65, 0.16, 0.16],
  gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5],
}

function mathColor(value: string): Color {
  const named = MATH_COLORS[value.toLowerCase()]
  if (named) return rgb(...named)
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value)?.[1]
  if (!hex) return INK
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex
  return rgb(
    Number.parseInt(full.slice(0, 2), 16) / 255,
    Number.parseInt(full.slice(2, 4), 16) / 255,
    Number.parseInt(full.slice(4, 6), 16) / 255,
  )
}

/** Draw a typeset equation with the left of its baseline at `x`, `baseline`,
 *  set at KaTeX's size for text of `size`; and write it over itself,
 *  invisibly, stretched to its width, so it can be searched and copied. */
function drawMath(
  context: DrawContext,
  typeset: TypesetMath,
  source: string,
  x: number,
  baseline: number,
  size: number,
): void {
  const { page } = context
  const scale = size * MATH_SIZE
  for (const mark of typeset.marks) {
    const color = mathColor(mark.color)
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(scale, 0, 0, scale, x, baseline),
      ...mark.clips.flatMap((corners) => [
        ...corners.map((corner, index) => (index === 0 ? moveTo : lineTo)(...corner)),
        closePath(),
        clip(),
        endPath(),
      ]),
      concatTransformationMatrix(...mark.matrix),
    )
    if (mark.kind === 'fill') {
      page.pushOperators(setFillingColor(color), ...pathOperators(mark.path), fill())
    }
    if (mark.kind === 'stroke') {
      page.pushOperators(
        setStrokingColor(color),
        setLineWidth(mark.width),
        ...pathOperators(mark.path),
        stroke(),
      )
    }
    if (mark.kind === 'text') {
      assertSupported(mark.text, context.fonts.regular)
      // pdf-lib sets a line of text `y` up; MathJax's is `y` down.
      page.pushOperators(concatTransformationMatrix(1, 0, 0, -1, 0, 0))
      page.drawText(mark.text, { x: 0, y: 0, size: mark.size, font: context.fonts.regular, color })
    }
    page.pushOperators(popGraphicsState())
  }

  const font = context.fonts.regular
  const supported = new Set(font.getCharacterSet())
  const written = [...mathText(source)]
    .filter((character) => supported.has(character.codePointAt(0)!))
    .join('')
    .trim()
  const writtenWidth = font.widthOfTextAtSize(written, size)
  if (!written || writtenWidth <= 0) return
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(typeset.width * scale / writtenWidth, 0, 0, 1, x, baseline),
  )
  page.drawText(written, { x: 0, y: 0, size, font, opacity: 0 })
  page.pushOperators(popGraphicsState())
}

function pathOperators(path: readonly PathStep[]): PDFOperator[] {
  return path.map((step) => {
    switch (step.op) {
      case 'move': return moveTo(...step.to)
      case 'line': return lineTo(...step.to)
      case 'quadratic': return appendQuadraticCurve(...step.control, ...step.to)
      case 'cubic': return appendBezierCurve(...step.controls, ...step.to)
      case 'close': return closePath()
    }
  })
}

/** An equation set on its own, centred in its column, as print sets it. */
function drawDisplayMath(context: DrawContext, source: string, x: number, width: number): void {
  const typeset = context.typeset(source, true)
  if (!typeset) {
    drawInline(context, writtenMathPieces(source, BODY_SIZE), { x: x + 24, width: width - 48 })
    context.y -= 4
    return
  }
  const size = BODY_SIZE * MATH_SIZE
  const gap = BODY_SIZE / 2
  const height = gap + (typeset.ascent + typeset.descent) * size + gap
  ensureRoom(context, height)
  const drawn = typeset.width * size
  const left = x + Math.max(0, (width - drawn) / 2)
  drawMath(context, typeset, source, left, context.y - gap - typeset.ascent * size, BODY_SIZE)
  context.y -= height
}

function splitPiece(piece: InlinePiece, font: PDFFont, maxWidth: number): InlinePiece[] {
  if (piece.text.startsWith('\uFFFC')) return [piece]
  const result: InlinePiece[] = []
  const tokens = piece.text.split(/(\s+|\n)/).filter(Boolean)
  for (const token of tokens) {
    if (token === '\n') {
      result.push({ ...piece, text: token })
      continue
    }
    assertSupported(token, font)
    if (font.widthOfTextAtSize(token, piece.size) <= maxWidth || /^\s+$/.test(token)) {
      result.push({ ...piece, text: token })
      continue
    }
    let current = ''
    for (const character of token) {
      const next = current + character
      if (current && font.widthOfTextAtSize(next, piece.size) > maxWidth) {
        result.push({ ...piece, text: current })
        current = character
      } else current = next
    }
    if (current) result.push({ ...piece, text: current })
  }
  return result
}

/** A piece of a line, where it starts and how wide it is. */
type PlacedPiece = { piece: InlinePiece; x: number; width: number }

function drawInline(
  context: DrawContext,
  pieces: readonly InlinePiece[],
  options: { x?: number; width?: number; size?: number; line?: number } = {},
): void {
  const x0 = options.x ?? context.x
  const width = options.width ?? context.width
  const line = options.line ?? BODY_LINE
  const normalized = pieces.flatMap((piece) => {
    const updated = options.size ? { ...piece, size: options.size } : piece
    if (updated.math !== undefined) {
      const typeset = context.typeset(updated.math, false)
      if (typeset) return [{ ...updated, typeset }]
      return writtenMathPieces(updated.math, updated.size)
        .flatMap((written) => splitPiece(written, context.fonts[written.font], width))
    }
    return splitPiece(updated, context.fonts[updated.font], width)
  })

  // Break the pieces into lines first: a line is as tall as the tallest
  // equation on it needs.
  const lines: PlacedPiece[][] = [[]]
  let x = x0
  for (const piece of normalized) {
    if (piece.text === '\n' && !piece.typeset) {
      lines.push([])
      x = x0
      continue
    }
    const pieceWidth = widthOf(context, piece, line)
    const visible = piece.typeset !== undefined || piece.text.trim() !== ''
    if (x > x0 && x + pieceWidth > x0 + width && visible) {
      lines.push([])
      x = x0
    }
    if (x === x0 && !visible) continue
    lines.at(-1)!.push({ piece, x, width: pieceWidth })
    x += pieceWidth
  }

  const top = context.y
  for (const placed of lines) {
    // Text sits `size` below the top of its line, with the rest of the line
    // below its baseline; an equation that reaches past either pushes the
    // line open by as much.
    const above = Math.max(0, ...placed.map(({ piece }) => piece.typeset
      ? piece.typeset.ascent * piece.size * MATH_SIZE - piece.size
      : 0))
    const below = Math.max(0, ...placed.map(({ piece }) => piece.typeset
      ? piece.typeset.descent * piece.size * MATH_SIZE - (line - piece.size)
      : 0))
    const height = above + line + below
    if (placed.length > 0) ensureRoom(context, top - context.y + height)
    const lineTop = context.y - above
    for (const { piece, x, width: pieceWidth } of placed) drawPiece(context, piece, x, pieceWidth, lineTop, line)
    context.y -= height
  }
}

function widthOf(context: DrawContext, piece: InlinePiece, line: number): number {
  if (piece.typeset) return piece.typeset.width * piece.size * MATH_SIZE
  if (piece.text.startsWith('\uFFFC')) {
    const loaded = context.images.get(piece.text.slice(1))
    if (!loaded) throw new RequiredMediaError(null)
    return line * 0.85 * loaded.source.width / loaded.source.height
  }
  return context.fonts[piece.font].widthOfTextAtSize(piece.text, piece.size)
}

/** One piece of a line whose text starts `line` below `lineTop`. */
function drawPiece(
  context: DrawContext,
  piece: InlinePiece,
  x: number,
  pieceWidth: number,
  lineTop: number,
  line: number,
): void {
  if (piece.typeset) {
    drawMath(context, piece.typeset, piece.math ?? '', x, lineTop - piece.size, piece.size)
    return
  }
  if (piece.text.startsWith('\uFFFC')) {
    const loaded = context.images.get(piece.text.slice(1))!
    const height = line * 0.85
    context.page.drawImage(loaded.image, { x, y: lineTop - height, width: pieceWidth, height })
    return
  }
  const font = context.fonts[piece.font]
  const y = lineTop - piece.size + (piece.rise ?? 0)
  context.page.drawText(piece.text, {
    x,
    y,
    font,
    size: piece.size,
    color: piece.href ? LINK : INK,
  })
  if (piece.href) addLink(context, piece.href, x, y, pieceWidth, piece.size + 2)
  if (piece.strike) {
    context.page.drawLine({
      start: { x, y: y + piece.size * 0.45 },
      end: { x: x + pieceWidth, y: y + piece.size * 0.45 },
      thickness: 0.6,
      color: INK,
    })
  }
}

function drawTextLine(
  context: DrawContext,
  text: string,
  options: { font?: keyof EmbeddedFonts; size?: number; x?: number; width?: number; line?: number } = {},
): void {
  drawInline(context, [{
    text,
    font: options.font ?? 'regular',
    size: options.size ?? BODY_SIZE,
  }], options)
}

// At the left of the column its block sits in, as print sets it: past a
// question's blank and number, past a choice's letter — never at the margin.
function drawImage(
  context: DrawContext,
  attrs: Record<string, unknown>,
  x: number,
  maxWidth: number,
  centred = false,
): void {
  const loaded = context.images.get(pictureKey(attrs))
  if (!loaded) throw new RequiredMediaError(null)
  const naturalWidth = loaded.source.width * POINTS_PER_PX
  const naturalHeight = loaded.source.height * POINTS_PER_PX
  const width = printedPictureWidth(naturalWidth, maxWidth, attrs)
  const height = naturalHeight * (width / naturalWidth)
  ensureRoom(context, height + 4)
  context.page.drawImage(loaded.image, {
    x: centred ? x + Math.max(0, (maxWidth - width) / 2) : x,
    y: context.y - height,
    width,
    height,
  })
  context.y -= height + 4
}

function drawBlocks(
  context: DrawContext,
  nodes: readonly ProseMirrorJSON[],
  options: { x?: number; width?: number; listLevel?: number; centred?: boolean } = {},
): void {
  const x = options.x ?? context.x
  const width = options.width ?? context.width
  let orderedIndex = 1
  for (const node of nodes) {
    const attrs = attrsOf(node)
    switch (node.type) {
      case 'paragraph':
        drawInline(context, textPieces(node), { x, width })
        context.y -= 2
        break
      case 'heading': {
        const level = Math.min(Math.max(Number(attrs.level) || 1, 1), 6)
        drawInline(context, textPieces(node), {
          x,
          width,
          size: Math.max(BODY_SIZE, 17 - level),
          line: 19,
        })
        context.y -= 3
        break
      }
      case 'blockquote':
        drawBox(context, childrenOf(node), x, width, options.centred)
        break
      case 'sideBySide':
        drawSideBySide(context, childrenOf(node), x, width)
        break
      case 'bullet_list':
      case 'ordered_list': {
        orderedIndex = Number(attrs.order) || 1
        for (const child of childrenOf(node)) {
          const marker = node.type === 'ordered_list' ? `${orderedIndex++}.` : '•'
          drawTextLine(context, marker, { x, width: 18 })
          context.y += BODY_LINE
          drawBlocks(context, childrenOf(child), { x: x + 18, width: width - 18 })
        }
        break
      }
      case 'list_item':
        drawBlocks(context, childrenOf(node), { x, width })
        break
      case 'code_block': {
        const source = childrenOf(node).map((child) => stringOf(child.text)).join('')
        if (stringOf(attrs.language).toLowerCase() === 'latex') {
          drawDisplayMath(context, source, x, width)
          break
        }
        drawInline(context, [{ text: source, font: 'mono', size: BODY_SIZE }], { x, width })
        context.y -= 4
        break
      }
      case 'image':
        // An inline picture has no size of its own: it fits its column.
        drawImage(context, { src: attrs.src }, x, width, options.centred)
        break
      case 'image-block': {
        drawImage(context, attrs, x, width, options.centred)
        const caption = stringOf(attrs.caption)
        if (caption) {
          const captionWidth = context.fonts.regular.widthOfTextAtSize(caption, SMALL_SIZE)
          const inset = options.centred ? Math.max(0, (width - captionWidth) / 2) : 0
          drawTextLine(context, caption, { size: SMALL_SIZE, x: x + inset, width: width - inset })
        }
        break
      }
      case 'hr':
        ensureRoom(context, 12)
        context.page.drawLine({
          start: { x, y: context.y - 5 },
          end: { x: x + width, y: context.y - 5 },
          color: RULE,
          thickness: 0.7,
        })
        context.y -= 12
        break
      case 'table':
        drawTable(context, node, x, width)
        break
      default:
        drawBlocks(context, childrenOf(node), { x, width })
        break
    }
  }
}

function drawTable(context: DrawContext, table: ProseMirrorJSON, x: number, width: number): void {
  const rows = childrenOf(table).filter((row) => row.type === 'table_row' || row.type === 'table_header_row')
  const columns = Math.max(1, ...rows.map((row) => childrenOf(row).length))
  const cellWidth = width / columns
  for (const row of rows) {
    const top = context.y
    let bottom = top - BODY_LINE - 8
    for (let column = 0; column < columns; column += 1) {
      const cell = childrenOf(row)[column]
      if (!cell) continue
      const cellContext = {
        ...context,
        x: x + column * cellWidth + 4,
        y: top - 4,
        width: cellWidth - 8,
      }
      // A cell carries the same rich document vocabulary as a stem: links,
      // marks, math, images, lists, and nested blocks remain semantic content.
      drawBlocks(cellContext, childrenOf(cell), {
        x: cellContext.x,
        width: cellContext.width,
      })
      bottom = Math.min(bottom, cellContext.y - 4)
    }
    ensureRoom(context, top - bottom)
    for (let column = 0; column < columns; column += 1) {
      context.page.drawRectangle({
        x: x + column * cellWidth,
        y: bottom,
        width: cellWidth,
        height: top - bottom,
        borderColor: RULE,
        borderWidth: 0.6,
      })
    }
    context.y = bottom
  }
  context.y -= 4
}

// Print's `.doc-content blockquote` padding, and its black border.
const BOX_PADDING_X = pt(10)
const BOX_PADDING_Y = pt(6)
const BOX_BORDER = rgb(0, 0, 0)

/** A Blockquote, boxed: its blocks drawn inside the padding, then the border
 *  ruled round the height they took. */
function drawBox(
  context: DrawContext,
  nodes: readonly ProseMirrorJSON[],
  x: number,
  width: number,
  centred = false,
): void {
  const top = context.y
  context.y -= BOX_PADDING_Y
  drawBlocks(context, nodes, {
    x: x + BOX_PADDING_X,
    width: width - BOX_PADDING_X * 2,
    centred,
  })
  context.y -= BOX_PADDING_Y
  ensureRoom(context, 0)
  context.page.drawRectangle({
    x,
    y: context.y,
    width,
    height: top - context.y,
    borderColor: BOX_BORDER,
    borderWidth: 0.75,
  })
  context.y -= 4
}

/** How tall `nodes` come out at `width`: drawn once on a page that is thrown
 *  away, since a Panel has to know the tallest Panel before it is placed. */
function measureBlocks(
  context: DrawContext,
  nodes: readonly ProseMirrorJSON[],
  width: number,
  centred: boolean,
): number {
  const scratch = context.document.addPage([context.page.getWidth(), context.page.getHeight()])
  const start = 1_000_000
  const measuring: DrawContext = { ...context, page: scratch, y: start, bottom: -Infinity }
  try {
    drawBlocks(measuring, nodes, { x: 0, width, centred })
  } finally {
    context.document.removePage(context.document.getPageCount() - 1)
  }
  return start - measuring.y
}

// Print's `.doc-side-by-side` column gap.
const PANEL_GAP = pt(16)

/** A Side-by-Side: equal Panels across the width, each centred vertically
 *  against the tallest, their pictures centred across them. */
function drawSideBySide(
  context: DrawContext,
  panels: readonly ProseMirrorJSON[],
  x: number,
  width: number,
): void {
  const count = Math.max(1, panels.length)
  const pitch = (width + PANEL_GAP) / count
  const panelWidth = pitch - PANEL_GAP
  const heights = panels.map((panel) =>
    measureBlocks(context, childrenOf(panel), panelWidth, true),
  )
  const tallest = Math.max(0, ...heights)
  const top = context.y
  ensureRoom(context, tallest)
  panels.forEach((panel, index) => {
    const panelContext: DrawContext = {
      ...context,
      y: top - (tallest - heights[index]!) / 2,
    }
    const left = x + index * pitch
    drawBlocks(panelContext, childrenOf(panel), { x: left, width: panelWidth, centred: true })
  })
  context.y = top - tallest - 4
}

function drawChoiceGrid(context: DrawContext, grid: ChoiceGrid, x: number, width: number): void {
  const cellWidth = width / grid.columns
  for (const row of grid.cells) {
    const top = context.y
    let rowBottom = top
    for (const [column, choice] of row.entries()) {
      if (!choice) continue
      const copy = { ...context, x: x + column * cellWidth, y: top, width: cellWidth - 8 }
      drawTextLine(copy, `${choice.letter}.`, { width: 16 })
      copy.y = top
      drawBlocks(copy, childrenOf(choice.node), { x: copy.x + 18, width: copy.width - 18 })
      rowBottom = Math.min(rowBottom, copy.y)
    }
    context.y = rowBottom - 2
  }
}

// A Short Answer question's work space: the plan's height, ruled at the plan's
// pitch when it is lined. This adapter sets its text by its own metrics, which
// can come out a little taller than the page it was planned against, so a work
// space gives up whatever room that cost it rather than failing publication —
// a space that fills its page reaches the foot of this one, not past it.
function drawWorkSpace(
  context: DrawContext,
  space: PlannedWorkSpace,
  x: number,
  width: number,
): void {
  if (space.height <= 0) return
  const height = Math.max(0, Math.min(pt(space.height), context.y - context.bottom))
  const top = context.y
  for (let rule = 1; rule <= space.lines; rule += 1) {
    const y = top - pt(WORK_SPACE_LINE_PITCH) * rule
    if (y < top - height - 0.01) break
    context.page.drawLine({
      start: { x, y },
      end: { x: x + width, y },
      thickness: 0.75,
      color: RULE,
    })
  }
  context.y = top - height
}

// A matching set as print lays it out (`.matching-*` in styles.css), across the
// question's full width. Each prompt opens with its bold blank and number in a
// 92px column and a 6px gap — `MATCHING_INDENT`. A short Word Bank stands in a 240px column to the
// prompts' right, set in 24px from its edge; a long one prints above them in
// columns, under the number column.
const MATCHING_NUMBER_COLUMN = MATCHING_INDENT
const MATCHING_BANK_INSET = 24
const MATCHING_GAP = 10

function drawMatchingAnswer(context: DrawContext, answer: PlannedBankAnswer): void {
  const top = context.y
  drawTextLine(context, `${answer.letter}.`, { width: 16 })
  context.y = top
  drawBlocks(context, childrenOf(answer.node), { x: context.x + 18, width: context.width - 18 })
}

function drawMatchingPrompts(context: DrawContext, set: MatchingSet): void {
  const column = pt(MATCHING_NUMBER_COLUMN)
  for (const prompt of set.prompts) {
    const top = context.y
    drawTextLine(context, `_______  ${prompt.number}.`, { font: 'bold', width: column - 5 })
    context.y = top
    drawBlocks(context, childrenOf(prompt.node), {
      x: context.x + column,
      width: context.width - column,
    })
    context.y -= pt(MATCHING_GAP)
  }
}

function drawMatching(context: DrawContext, set: MatchingSet): void {
  if (set.bankGrid) {
    const column = pt(MATCHING_NUMBER_COLUMN)
    const cellWidth = (context.width - column) / set.bankGrid.columns
    for (const row of set.bankGrid.cells) {
      const top = context.y
      let rowBottom = top
      for (const [index, answer] of row.entries()) {
        if (!answer) continue
        const cell = { ...context, x: context.x + column + index * cellWidth, y: top, width: cellWidth - 9 }
        drawMatchingAnswer(cell, answer)
        rowBottom = Math.min(rowBottom, cell.y)
      }
      context.y = rowBottom - 3
    }
    context.y -= pt(14)
    drawMatchingPrompts(context, set)
    return
  }

  const top = context.y
  const bankWidth = pt(MATCHING_BANK_WIDTH)
  const prompts = { ...context, width: context.width - bankWidth }
  drawMatchingPrompts(prompts, set)
  const bank = {
    ...context,
    x: context.x + context.width - bankWidth + pt(MATCHING_BANK_INSET),
    y: top,
    width: bankWidth - pt(MATCHING_BANK_INSET),
  }
  for (const answer of set.bank) {
    drawMatchingAnswer(bank, answer)
    bank.y -= pt(MATCHING_GAP)
  }
  context.y = Math.min(prompts.y, bank.y)
}

// A Multipart question's Parts, one level in under the Multipart question, as print lays them out
// (`.multipart-parts-print` in styles.css): 14px below the Multipart question, 18px
// apart, each opening with its letter in a short letter column of its own.
const PARTS_GAP_ABOVE = 14
const PARTS_GAP_BETWEEN = 18

function drawPart(context: DrawContext, part: PlannedPart, x: number, width: number): void {
  const indent = pt(PART_INDENT)
  const bodyX = x + indent
  const bodyWidth = width - indent
  drawTextLine(
    context,
    `${part.letter}.`,
    { font: 'bold', x, width: indent - 5 },
  )
  context.y += BODY_LINE
  if (part.stem.length > 0) drawBlocks(context, part.stem, { x: bodyX, width: bodyWidth })
  else context.y -= BODY_LINE
  if (part.grid) drawChoiceGrid(context, part.grid, bodyX, bodyWidth)
  if (part.workSpace) drawWorkSpace(context, part.workSpace, bodyX, bodyWidth)
}

function drawQuestion(context: DrawContext, item: QuestionItem): void {
  const indent = questionIndentOf(item.question) * POINTS_PER_PX
  const bodyX = context.x + indent
  const bodyWidth = context.width - indent
  if (printsNumberLine(item)) {
    const prefix = [...item.question.marks, `${item.question.number}.`].join('  ')
    drawTextLine(context, prefix, { font: 'bold', width: indent - 5 })
    context.y += BODY_LINE
  }
  drawBlocks(context, item.stem, { x: bodyX, width: bodyWidth })
  if (item.grid) drawChoiceGrid(context, item.grid, bodyX, bodyWidth)
  if (item.matching) drawMatching(context, item.matching)
  if (item.workSpace) {
    drawWorkSpace(context, item.workSpace, bodyX, bodyWidth)
    // Nothing follows a space that fills its page, so it keeps the foot.
    if (item.workSpace.fill) return
  }
  const parts = item.parts ?? []
  for (const [index, part] of parts.entries()) {
    context.y -= pt(index === 0 ? PARTS_GAP_ABOVE : PARTS_GAP_BETWEEN)
    drawPart(context, part, bodyX, bodyWidth)
  }
  if (parts.at(-1)?.workSpace?.fill) return
  context.y -= 10
}

function drawItem(context: DrawContext, item: PageItem): void {
  switch (item.kind) {
    case 'section-heading': {
      // A cleared part draws nothing, and a heading cleared of both draws
      // nothing at all — the plan packed it at no height.
      if (!item.title && !item.instructions) return
      // Line heights grow with the Exam's heading size, as print's ratios do.
      const size = sectionHeadingPoints(item.size)
      context.y -= 12
      if (item.title) {
        drawTextLine(context, item.title, {
          font: 'bold',
          size: size.title,
          line: 17 * (size.title / HEADING_SIZE),
        })
      }
      if (item.instructions) {
        drawTextLine(context, item.instructions, {
          size: size.instructions,
          line: 17 * (size.instructions / SHEET_BODY_SIZE),
        })
      }
      context.y -= 8
      return
    }
    case 'question':
      drawQuestion(context, item)
      return
    case 'answer-key-heading':
      drawTextLine(context, 'Answer Section', { font: 'bold', size: ANSWER_KEY_HEADING_SIZE, line: 20 })
      context.y -= 8
      return
    case 'answer-key-section':
      drawTextLine(context, item.title, { font: 'bold', size: HEADING_SIZE, line: 18 })
      context.y -= 4
      return
    case 'answer-key-entry':
      drawAnswerKeyEntry(context, item)
      return
  }
}

function drawAnswerKeyEntry(context: DrawContext, item: AnswerKeyEntryItem): void {
  const metadata = [
    ...(item.difficulty ? [DIFFICULTY_LABELS[item.difficulty]] : []),
    ...(item.topics ?? []),
  ]
  const tagStart = context.x + 88
  const tagWidth = context.width - 88
  const gap = 5
  const padding = 5
  let tagX = tagStart
  let tagLine = 0
  const tags = metadata.map((label) => {
    assertSupported(label, context.fonts.regular)
    const width = Math.min(
      context.fonts.regular.widthOfTextAtSize(label, SMALL_SIZE) + padding * 2,
      tagWidth,
    )
    if (tagX > tagStart && tagX + width > tagStart + tagWidth) {
      tagLine += 1
      tagX = tagStart
    }
    const tag = { label, x: tagX, line: tagLine, width }
    tagX += width + gap
    return tag
  })
  const lines = Math.max(1, tagLine + 1)
  ensureRoom(context, lines * BODY_LINE + 2)
  const rowY = context.y

  drawTextLine(context, `${item.number}.`, { width: 32 })
  context.y = rowY
  if (item.letter) drawTextLine(context, item.letter, { font: 'bold', x: context.x + ANSWER_KEY_ANSWER_X, width: 42 })
  else context.y -= BODY_LINE
  context.page.drawLine({
    start: { x: context.x + 36, y: rowY - BODY_LINE + 3 },
    end: { x: context.x + 78, y: rowY - BODY_LINE + 3 },
    thickness: 0.6,
    color: INK,
  })

  for (const tag of tags) {
    const y = rowY - tag.line * BODY_LINE - SMALL_SIZE - 1
    context.page.drawRectangle({
      x: tag.x,
      y,
      width: tag.width,
      height: SMALL_SIZE + 4,
      color: TAG_FILL,
      borderColor: TAG_BORDER,
      borderWidth: 0.5,
    })
    context.page.drawText(tag.label, {
      x: tag.x + padding,
      y: y + 2.5,
      font: context.fonts.regular,
      size: SMALL_SIZE,
      color: INK,
    })
  }
  context.y = rowY - lines * BODY_LINE - 2
  // A Suggested Answer starts under the blank, below the whole row.
  if (item.suggestedAnswer) {
    drawBlocks(context, item.suggestedAnswer, {
      x: context.x + ANSWER_KEY_ANSWER_X,
      width: context.width - ANSWER_KEY_ANSWER_X,
    })
    context.y -= 4
  }
  // A Multipart question's Parts each take a line under its number, the Part's letter
  // where a question's number goes and its answer on the blank beside it.
  for (const part of item.parts ?? []) {
    ensureRoom(context, BODY_LINE + 2)
    const partY = context.y
    const partX = context.x + ANSWER_KEY_ANSWER_X
    drawTextLine(context, `${part.letter}.`, { x: partX, width: 18 })
    context.y = partY
    if (part.answer) drawTextLine(context, part.answer, { font: 'bold', x: partX + 24, width: 42 })
    else context.y -= BODY_LINE
    context.page.drawLine({
      start: { x: partX + 22, y: partY - BODY_LINE + 3 },
      end: { x: partX + 64, y: partY - BODY_LINE + 3 },
      thickness: 0.6,
      color: INK,
    })
    context.y = partY - BODY_LINE - 2
    if (part.suggestedAnswer) {
      drawBlocks(context, part.suggestedAnswer, {
        x: partX + 24,
        width: context.width - ANSWER_KEY_ANSWER_X - 24,
      })
      context.y -= 4
    }
  }
}

// An Exam's own header line: its text from the left margin, the ID in bold
// against the right, as print sets them. It is one line on every output, so
// text too long for the room the ID leaves is cut short, as print cuts it.
function drawIdentityLine(context: DrawContext, text: string, label: string): void {
  const bold = context.fonts.bold
  const regular = context.fonts.regular
  const labelWidth = bold.widthOfTextAtSize(label, SHEET_BODY_SIZE)
  const y = context.y - SHEET_BODY_SIZE
  context.page.drawText(label, {
    x: context.x + context.width - labelWidth,
    y,
    size: SHEET_BODY_SIZE,
    font: bold,
    color: INK,
  })
  const room = context.width - labelWidth - 12
  let shown = text.trimEnd()
  while (shown && regular.widthOfTextAtSize(shown, SHEET_BODY_SIZE) > room) {
    shown = shown.slice(0, -1)
  }
  if (shown) {
    context.page.drawText(shown, { x: context.x, y, size: SHEET_BODY_SIZE, font: regular, color: INK })
  }
}

function drawFurniture(
  context: DrawContext,
  furniture: PageFurniture,
  pageTop: number,
  headerBottom: number,
): void {
  if (furniture.identityLine !== undefined) {
    drawIdentityLine(context, furniture.identityLine, furniture.arrangementLabel)
  } else {
    const pieces: InlinePiece[] = []
    for (const field of furniture.identityFields) {
      pieces.push({ text: `${field}: __________________  `, font: 'regular', size: SMALL_SIZE })
    }
    pieces.push({ text: furniture.arrangementLabel, font: 'bold', size: SMALL_SIZE })
    drawInline(context, pieces, { x: context.x, width: context.width, line: 13 })
  }
  if (furniture.title !== null) {
    const titleContext = { ...context, y: pageTop - 36, bottom: headerBottom }
    drawInline(
      titleContext,
      [{ text: furniture.title, font: 'bold', size: titlePoints(furniture.titleSize) }],
      { x: context.x, width: context.width, line: titlePoints(furniture.titleSize) * 1.15 },
    )
  }
}

async function embedImages(
  document: PDFDocument,
  images: ReadonlyMap<string, ExportImage>,
): Promise<Map<string, { source: ExportImage; image: PDFImage }>> {
  const embedded = new Map<string, { source: ExportImage; image: PDFImage }>()
  for (const [source, image] of images) {
    const value = image.type === 'png'
      ? await document.embedPng(image.data)
      : await document.embedJpg(image.data)
    embedded.set(source, { source: image, image: value })
  }
  return embedded
}

/** Whether a plan, or any part of one, holds an equation. */
function holdsMath(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(holdsMath)
  if (typeof value !== 'object' || value === null) return false
  const node = value as ProseMirrorJSON
  if (node.type === 'math_inline') return true
  if (node.type === 'code_block' && stringOf(attrsOf(node).language).toLowerCase() === 'latex') return true
  return Object.values(node).some(holdsMath)
}

/** Each equation the plans draw typeset once, MathJax loaded only for plans
 *  that have one. */
async function mathTypesetter(plans: readonly LayoutPlan[]): Promise<DrawContext['typeset']> {
  if (!holdsMath(plans)) return () => null
  const tools = await mathJaxTools()
  const typeset = new Map<string, TypesetMath | null>()
  return (source, display) => {
    const key = `${display ? 'display' : 'inline'}:${source}`
    if (!typeset.has(key)) typeset.set(key, typesetMath(tools, source, display))
    return typeset.get(key)!
  }
}

async function createPdf(
  plans: readonly LayoutPlan[],
  media: MediaLoader,
  fontLoader: PdfFontLoader,
  strictMedia: boolean,
  attachment?: string,
): Promise<Uint8Array> {
  if (typeof Uint8Array === 'undefined' || typeof Promise === 'undefined') {
    throw new Error('This browser does not support local PDF generation. Choose DOCX instead.')
  }
  const document = await PDFDocument.create()
  document.registerFontkit(fontkit)
  const [regularBytes, boldBytes, italicBytes, boldItalicBytes, monoBytes] = await Promise.all([
    fontLoader('regular'),
    fontLoader('bold'),
    fontLoader('italic'),
    fontLoader('boldItalic'),
    fontLoader('mono'),
  ])
  const fonts: EmbeddedFonts = {
    regular: await document.embedFont(regularBytes, { subset: true }),
    bold: await document.embedFont(boldBytes, { subset: true }),
    italic: await document.embedFont(italicBytes, { subset: true }),
    boldItalic: await document.embedFont(boldItalicBytes, { subset: true }),
    mono: await document.embedFont(monoBytes, { subset: true }),
  }
  const loaded = await loadExportImages(plans, media)
  if (strictMedia) {
    const missing = missingPicture(plans, loaded)
    if (missing) throw new RequiredMediaError(questionNumberForMedia(plans, missing.src))
  }
  const images = await embedImages(document, loaded)
  const typeset = await mathTypesetter(plans)
  document.setTitle(plans[0]?.title ?? '')
  document.setCreator('Test Parrot')

  try {
    for (const plan of plans) {
      const scale = bodyScale(plan.textSize)
      BODY_SIZE = SHEET_BODY_SIZE * scale
      BODY_LINE = SHEET_BODY_LINE * scale
      for (const planned of plan.pages) {
        const width = pt(plan.pageSize.width)
        const height = pt(plan.pageSize.height)
        const margin = pt(plan.pageSize.margin)
        const page = document.addPage([width, height])
        const top = height - margin
        const headerHeight = planned.header === 'first' || planned.header === 'answer-key'
          ? pt(84)
          : pt(42)
        const footerHeight = pt(36)
        const context: DrawContext = {
          document,
          page,
          fonts,
          images,
          x: margin,
          y: top,
          width: pt(plan.pageSize.contentWidth),
          bottom: margin + footerHeight,
          pageNumber: planned.number,
          typeset,
        }
        drawFurniture(context, planned.furniture, top, top - headerHeight)
        context.y = top - headerHeight
        for (const item of planned.items) drawItem(context, item)
        const footer = String(planned.furniture.pageNumber)
        assertSupported(footer, fonts.regular)
        const footerWidth = fonts.regular.widthOfTextAtSize(footer, SMALL_SIZE)
        page.drawText(footer, {
          x: (width - footerWidth) / 2,
          y: margin,
          size: SMALL_SIZE,
          font: fonts.regular,
          color: INK,
        })
      }
    }
  } finally {
    BODY_SIZE = SHEET_BODY_SIZE
    BODY_LINE = SHEET_BODY_LINE
  }
  if (attachment !== undefined) {
    // The same attachment identity a Question Bank File uses, so one importer
    // reads both.
    await document.attach(new TextEncoder().encode(attachment), QUESTION_BANK_ATTACHMENT_NAME, {
      mimeType: 'application/json',
      description: QUESTION_BANK_ATTACHMENT_DESCRIPTION,
      afRelationship: AFRelationship.Source,
    })
  }
  return document.save({ useObjectStreams: false })
}

/** Tolerant adapter entry point for diagnostics. Publication uses the strict
 * entry point below so retained Media Assets may never silently disappear. */
export function createExamPdf(
  plans: readonly LayoutPlan[],
  media: MediaLoader = browserMedia,
  fonts: PdfFontLoader = browserPdfFonts,
): Promise<Uint8Array> {
  return createPdf(plans, media, fonts, false)
}

export function createPublicationPdf(
  plans: readonly LayoutPlan[],
  media: MediaLoader = browserMedia,
  fonts: PdfFontLoader = browserPdfFonts,
  /** A serialized Test Parrot Package to embed; see `exam-package-export`. */
  examPackage?: string,
): Promise<Uint8Array> {
  return createPdf(plans, media, fonts, true, examPackage)
}

export function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes], { type: PDF_MIME })
}

export function savePdfFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

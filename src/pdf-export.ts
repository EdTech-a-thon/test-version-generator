// The PDF Export Adapter.
//
// It consumes retained Layout Plans exactly like the DOCX adapter: one PDF page
// per planned page, in selected-plan order, with no measurement or pagination.
// Text is emitted as font-backed PDF text, links as annotations, and Media
// Assets as image XObjects. Any content that would escape its planned content
// box stops publication instead of being clipped, shrunk, or repaginated.

import fontkit from '@pdf-lib/fontkit'
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFString,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib'
import {
  browserMedia,
  imageSourcesOf,
  loadExportImages,
  questionNumberForMedia,
  RequiredMediaError,
  type ExportImage,
  type MediaLoader,
} from './export-media'
import type {
  AnswerKeyEntryItem,
  ChoiceGrid,
  LayoutPlan,
  PageFurniture,
  PageItem,
  QuestionItem,
} from './export-plan'
import { DIFFICULTY_LABELS } from './exam'
import type { ProseMirrorJSON } from './question-doc'

const PDF_MIME = 'application/pdf'
const POINTS_PER_PX = 0.75
const BODY_SIZE = 11.25
const BODY_LINE = 16.3
const SMALL_SIZE = 9.75
const HEADING_SIZE = 12.75
const TITLE_SIZE = 19.5
const QUESTION_INDENT = (92 + 6) * POINTS_PER_PX
const INK = rgb(0.2, 0.165, 0.14)
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
}

type InlinePiece = {
  text: string
  font: keyof EmbeddedFonts
  size: number
  href?: string
  rise?: number
  strike?: boolean
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
      pieces.push(...mathPieces(stringOf(attrsOf(current).value)))
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

const MATH_COMMANDS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ',
  lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', phi: 'φ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ',
  Phi: 'Φ', Omega: 'Ω', times: '×', cdot: '·', pm: '±', leq: '≤', geq: '≥',
  neq: '≠', approx: '≈', infty: '∞', rightarrow: '→', leftarrow: '←',
}

/** A small math layout vocabulary covering the editor's existing fixtures and
 * common school notation. It retains text operators while giving fractions,
 * roots, superscripts, subscripts and Greek commands their authored form. */
function mathPieces(source: string): InlinePiece[] {
  const pieces: InlinePiece[] = []
  let index = 0
  const push = (text: string, size = BODY_SIZE, rise = 0) => {
    if (text) pieces.push({ text, font: 'regular', size, rise })
  }
  while (index < source.length) {
    const rest = source.slice(index)
    const fraction = /^\\frac\{([^{}]*)\}\{([^{}]*)\}/.exec(rest)
    if (fraction) {
      push(fraction[1]!)
      push('⁄')
      push(fraction[2]!)
      index += fraction[0].length
      continue
    }
    const root = /^\\sqrt\{([^{}]*)\}/.exec(rest)
    if (root) {
      push(`√${root[1]}`)
      index += root[0].length
      continue
    }
    const script = /^([_^])(?:\{([^{}]*)\}|(.))/.exec(rest)
    if (script) {
      push(
        script[2] ?? script[3] ?? '',
        BODY_SIZE * 0.75,
        script[1] === '^' ? BODY_SIZE * 0.35 : -BODY_SIZE * 0.2,
      )
      index += script[0].length
      continue
    }
    const command = /^\\([A-Za-z]+)/.exec(rest)
    if (command) {
      push(MATH_COMMANDS[command[1]!] ?? command[1]!)
      index += command[0].length
      continue
    }
    push(source[index]!)
    index += 1
  }
  return pieces
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
    return splitPiece(updated, context.fonts[updated.font], width)
  })
  let x = x0
  let lines = 1
  const nextLine = () => {
    lines += 1
    x = x0
  }
  for (const piece of normalized) {
    if (piece.text === '\n') {
      nextLine()
      continue
    }
    if (piece.text.startsWith('\uFFFC')) {
      const source = piece.text.slice(1)
      const loaded = context.images.get(source)
      if (!loaded) throw new RequiredMediaError(null)
      const height = line * 0.85
      const pieceWidth = height * loaded.source.width / loaded.source.height
      if (x > x0 && x + pieceWidth > x0 + width) nextLine()
      ensureRoom(context, lines * line)
      context.page.drawImage(loaded.image, {
        x,
        y: context.y - (lines - 1) * line - height,
        width: pieceWidth,
        height,
      })
      x += pieceWidth
      continue
    }
    const font = context.fonts[piece.font]
    const text = piece.text
    const pieceWidth = font.widthOfTextAtSize(text, piece.size)
    if (x > x0 && x + pieceWidth > x0 + width && text.trim()) nextLine()
    if (x === x0 && /^\s+$/.test(text)) continue
    ensureRoom(context, lines * line)
    const y = context.y - (lines - 1) * line - piece.size + (piece.rise ?? 0)
    context.page.drawText(text, {
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
    x += pieceWidth
  }
  context.y -= lines * line
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

function drawImage(
  context: DrawContext,
  source: string,
  maxWidth: number,
  authoredRatio = 1,
): void {
  const loaded = context.images.get(source)
  if (!loaded) throw new RequiredMediaError(null)
  const ratio = Number.isFinite(authoredRatio)
    ? Math.min(1, Math.max(0.05, authoredRatio))
    : 1
  const authoredMaxWidth = maxWidth * ratio
  const naturalWidth = loaded.source.width * POINTS_PER_PX
  const naturalHeight = loaded.source.height * POINTS_PER_PX
  const scale = Math.min(1, authoredMaxWidth / naturalWidth)
  const width = naturalWidth * scale
  const height = naturalHeight * scale
  ensureRoom(context, height + 4)
  context.page.drawImage(loaded.image, {
    x: context.x,
    y: context.y - height,
    width,
    height,
  })
  context.y -= height + 4
}

function drawBlocks(
  context: DrawContext,
  nodes: readonly ProseMirrorJSON[],
  options: { x?: number; width?: number; listLevel?: number } = {},
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
        drawBlocks(context, childrenOf(node), { x: x + 18, width: width - 18 })
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
        const displayMath = stringOf(attrs.language).toLowerCase() === 'latex'
        drawInline(
          context,
          displayMath
            ? mathPieces(source)
            : [{ text: source, font: 'mono', size: BODY_SIZE }],
          {
            x: displayMath ? x + 24 : x,
            width: displayMath ? width - 48 : width,
          },
        )
        context.y -= 4
        break
      }
      case 'image':
        drawImage(context, stringOf(attrs.src), width)
        break
      case 'image-block': {
        drawImage(context, stringOf(attrs.src), width, Number(attrs.ratio) || 1)
        const caption = stringOf(attrs.caption)
        if (caption) drawTextLine(context, caption, { size: SMALL_SIZE, x, width })
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

function drawQuestion(context: DrawContext, item: QuestionItem): void {
  const bodyX = context.x + QUESTION_INDENT
  const bodyWidth = context.width - QUESTION_INDENT
  if (item.numbered) {
    const prefix = item.question.answerBlank
      ? `_______  ${item.question.number}.`
      : `${item.question.number}.`
    drawTextLine(context, prefix, { font: 'bold', width: QUESTION_INDENT - 5 })
    context.y += BODY_LINE
  }
  drawBlocks(context, item.stem, { x: bodyX, width: bodyWidth })
  if (item.grid) drawChoiceGrid(context, item.grid, bodyX, bodyWidth)
  context.y -= 10
}

function drawItem(context: DrawContext, item: PageItem): void {
  switch (item.kind) {
    case 'section-heading':
      context.y -= 12
      drawTextLine(context, item.title, { font: 'bold', size: HEADING_SIZE, line: 17 })
      drawTextLine(context, item.instructions, { size: BODY_SIZE, line: 17 })
      context.y -= 8
      return
    case 'question':
      drawQuestion(context, item)
      return
    case 'answer-key-heading':
      drawTextLine(context, 'Answer Section', { font: 'bold', size: 15, line: 20 })
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
  if (item.letter) drawTextLine(context, item.letter, { font: 'bold', x: context.x + 38, width: 42 })
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
}

function drawFurniture(
  context: DrawContext,
  furniture: PageFurniture,
  pageTop: number,
  headerBottom: number,
): void {
  const pieces: InlinePiece[] = []
  for (const field of furniture.identityFields) {
    pieces.push({ text: `${field}: __________________  `, font: 'regular', size: SMALL_SIZE })
  }
  pieces.push({ text: furniture.arrangementLabel, font: 'bold', size: SMALL_SIZE })
  drawInline(context, pieces, { x: context.x, width: context.width, line: 13 })
  if (furniture.title !== null) {
    const titleContext = { ...context, y: pageTop - 36, bottom: headerBottom }
    drawInline(
      titleContext,
      [{ text: furniture.title, font: 'bold', size: TITLE_SIZE }],
      { x: context.x, width: context.width, line: TITLE_SIZE * 1.15 },
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

async function createPdf(
  plans: readonly LayoutPlan[],
  media: MediaLoader,
  fontLoader: PdfFontLoader,
  strictMedia: boolean,
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
    const missing = imageSourcesOf(plans).find((source) => !loaded.has(source))
    if (missing) throw new RequiredMediaError(questionNumberForMedia(plans, missing))
  }
  const images = await embedImages(document, loaded)
  document.setTitle(plans[0]?.title ?? '')
  document.setCreator('Test Parrot')

  for (const plan of plans) {
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
): Promise<Uint8Array> {
  return createPdf(plans, media, fonts, true)
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

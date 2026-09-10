import fontkit from '@pdf-lib/fontkit'
import {
  AFRelationship,
  PDFArray,
  PDFDocument,
  PDFName,
  PDFString,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import {
  QUESTION_BANK_ATTACHMENT_DESCRIPTION,
  QUESTION_BANK_ATTACHMENT_NAME,
  type PreparedQuestionBankExport,
  type SemanticDocument,
  type SemanticNode,
} from './question-bank-export'

export type QuestionBankPdfFontStyle =
  'regular' | 'bold' | 'italic' | 'boldItalic' | 'mono'
export type QuestionBankPdfFontLoader = (
  style: QuestionBankPdfFontStyle,
) => Promise<ArrayBuffer | Uint8Array>

export const browserQuestionBankPdfFonts: QuestionBankPdfFontLoader = async (
  style,
) => {
  const files: Record<QuestionBankPdfFontStyle, string> = {
    regular: '/fonts/FreeSerif.ttf',
    bold: '/fonts/FreeSerifBold.ttf',
    italic: '/fonts/FreeSerifItalic.ttf',
    boldItalic: '/fonts/FreeSerifBoldItalic.ttf',
    mono: '/fonts/FreeMono.ttf',
  }
  const response = await fetch(files[style])
  if (!response.ok)
    throw new Error(
      `The bundled PDF font (${style}) could not be loaded. Try again.`,
    )
  return response.arrayBuffer()
}

type Fonts = Record<QuestionBankPdfFontStyle, PDFFont>
type Context = {
  document: PDFDocument
  page: PDFPage
  fonts: Fonts
  y: number
  pageNumber: number
}

type Piece = {
  text: string
  font: QuestionBankPdfFontStyle
  size: number
  href?: string
  rise?: number
  strike?: boolean
}

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 54
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const BODY_SIZE = 10.5
const BODY_LINE = 15
const INK = rgb(0.18, 0.15, 0.13)
const MUTED = rgb(0.38, 0.34, 0.3)
const RULE = rgb(0.72, 0.68, 0.62)
const LINK = rgb(0.08, 0.3, 0.7)

function addPage(context: Context): void {
  context.page = context.document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  context.pageNumber += 1
  context.y = PAGE_HEIGHT - MARGIN
  const footer = String(context.pageNumber)
  const width = context.fonts.regular.widthOfTextAtSize(footer, 8)
  context.page.drawText(footer, {
    x: (PAGE_WIDTH - width) / 2,
    y: 28,
    font: context.fonts.regular,
    size: 8,
    color: MUTED,
  })
}

function ensure(context: Context, height: number): void {
  if (context.y - height < MARGIN) addPage(context)
}

function splitWords(text: string): string[] {
  return text.split(/(\s+|\n)/).filter(Boolean)
}

function addLink(
  context: Context,
  href: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const annotation = context.document.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [x, y, x + width, y + height],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(href) },
  })
  const reference = context.document.context.register(annotation)
  let annotations = context.page.node.lookupMaybe(
    PDFName.of('Annots'),
    PDFArray,
  )
  if (!annotations) {
    annotations = context.document.context.obj([])
    context.page.node.set(PDFName.of('Annots'), annotations)
  }
  annotations.push(reference)
}

function drawPieces(
  context: Context,
  pieces: readonly Piece[],
  options: { x?: number; width?: number; line?: number } = {},
): void {
  const x0 = options.x ?? MARGIN
  const maxWidth = options.width ?? CONTENT_WIDTH
  const line = options.line ?? BODY_LINE
  let x = x0
  let lineCount = 1
  ensure(context, line)
  for (const piece of pieces) {
    for (const token of splitWords(piece.text)) {
      if (token === '\n') {
        context.y -= line
        lineCount = 1
        x = x0
        ensure(context, line)
        continue
      }
      const font = context.fonts[piece.font]
      const width = font.widthOfTextAtSize(token, piece.size)
      if (x > x0 && x + width > x0 + maxWidth && token.trim()) {
        context.y -= line
        lineCount = 1
        x = x0
        ensure(context, line)
      }
      if (x === x0 && /^\s+$/.test(token)) continue
      const y = context.y - piece.size + (piece.rise ?? 0)
      context.page.drawText(token, {
        x,
        y,
        font,
        size: piece.size,
        color: piece.href ? LINK : INK,
      })
      if (piece.href) addLink(context, piece.href, x, y, width, piece.size + 2)
      if (piece.strike)
        context.page.drawLine({
          start: { x, y: y + piece.size * 0.45 },
          end: { x: x + width, y: y + piece.size * 0.45 },
          thickness: 0.6,
          color: INK,
        })
      x += width
    }
  }
  context.y -= line * lineCount
}

function drawText(
  context: Context,
  value: string,
  options: Partial<Piece> & { x?: number; width?: number; line?: number } = {},
): void {
  drawPieces(
    context,
    [
      {
        text: value,
        font: options.font ?? 'regular',
        size: options.size ?? BODY_SIZE,
        href: options.href,
        rise: options.rise,
        strike: options.strike,
      },
    ],
    options,
  )
}

function inlinePieces(nodes: readonly SemanticNode[]): Piece[] {
  const pieces: Piece[] = []
  for (const node of nodes) {
    if (node.type === 'text') {
      let bold = false
      let italic = false
      let font: QuestionBankPdfFontStyle = 'regular'
      let size = BODY_SIZE
      let rise = 0
      let href: string | undefined
      let strike = false
      for (const mark of node.marks ?? []) {
        if (mark.type === 'strong') bold = true
        if (mark.type === 'emphasis') italic = true
        if (mark.type === 'inline-code') font = 'mono'
        if (mark.type === 'subscript') {
          size *= 0.75
          rise = -2
        }
        if (mark.type === 'superscript') {
          size *= 0.75
          rise = 4
        }
        if (mark.type === 'strike') strike = true
        if (mark.type === 'link') href = mark.href
      }
      if (font !== 'mono')
        font =
          bold && italic
            ? 'boldItalic'
            : bold
              ? 'bold'
              : italic
                ? 'italic'
                : 'regular'
      pieces.push({ text: node.text ?? '', font, size, rise, href, strike })
    } else if (node.type === 'hard-break') {
      pieces.push({ text: '\n', font: 'regular', size: BODY_SIZE })
    } else if (node.type === 'inline-math') {
      pieces.push({ text: node.source ?? '', font: 'italic', size: BODY_SIZE })
    } else if (node.content) {
      pieces.push(...inlinePieces(node.content))
    }
  }
  return pieces
}

function drawBlocks(
  context: Context,
  nodes: readonly SemanticNode[],
  options: { x?: number; width?: number; listLevel?: number } = {},
): void {
  const x = options.x ?? MARGIN
  const width = options.width ?? CONTENT_WIDTH
  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph':
        drawPieces(context, inlinePieces(node.content ?? []), { x, width })
        context.y -= 3
        break
      case 'heading':
        drawPieces(context, inlinePieces(node.content ?? []), {
          x,
          width,
          line: 20,
        })
        context.y -= 4
        break
      case 'blockquote':
        drawBlocks(context, node.content ?? [], {
          x: x + 18,
          width: width - 18,
        })
        break
      case 'bullet-list':
      case 'ordered-list': {
        let ordinal = node.start ?? 1
        for (const item of node.content ?? []) {
          drawText(
            context,
            node.type === 'bullet-list' ? '•' : `${ordinal++}.`,
            { x, width: 20 },
          )
          context.y += BODY_LINE
          drawBlocks(context, item.content ?? [], {
            x: x + 20,
            width: width - 20,
          })
        }
        break
      }
      case 'list-item':
        drawBlocks(context, node.content ?? [], { x, width })
        break
      case 'code-block':
        drawText(context, node.text ?? '', { x, width, font: 'mono' })
        context.y -= 4
        break
      case 'display-math':
        drawText(context, node.source ?? '', {
          x: x + 18,
          width: width - 36,
          font: 'italic',
        })
        context.y -= 4
        break
      case 'rule':
        ensure(context, 14)
        context.page.drawLine({
          start: { x, y: context.y - 5 },
          end: { x: x + width, y: context.y - 5 },
          color: RULE,
        })
        context.y -= 14
        break
      case 'table':
        drawTable(context, node, x, width)
        break
      default:
        drawBlocks(context, node.content ?? [], { x, width })
    }
  }
}

function drawTable(
  context: Context,
  table: SemanticNode,
  x: number,
  width: number,
): void {
  const rows = table.content ?? []
  const columns = Math.max(1, ...rows.map((row) => row.content?.length ?? 0))
  for (const row of rows) {
    const cells = row.content ?? []
    const cellText = cells.map((cell) =>
      inlinePieces(cell.content ?? [])
        .map((piece) => piece.text)
        .join(''),
    )
    const requiredLines = Math.max(
      1,
      ...cellText.map((value) =>
        Math.ceil(value.length / Math.max(12, Math.floor(width / columns / 6))),
      ),
    )
    const height = requiredLines * BODY_LINE + 8
    ensure(context, height)
    const top = context.y
    cells.forEach((cell, column) => {
      const cellWidth = width / columns
      context.page.drawRectangle({
        x: x + column * cellWidth,
        y: top - height,
        width: cellWidth,
        height,
        borderColor: RULE,
        borderWidth: 0.6,
      })
      const copy = { ...context, y: top - 4 }
      drawPieces(copy, inlinePieces(cell.content ?? []), {
        x: x + column * cellWidth + 4,
        width: cellWidth - 8,
      })
    })
    context.y -= height
  }
  context.y -= 5
}

function drawLabel(context: Context, label: string, value: string): void {
  drawPieces(context, [
    { text: `${label}: `, font: 'bold', size: BODY_SIZE },
    { text: value, font: 'regular', size: BODY_SIZE },
  ])
}

function drawDocument(context: Context, document: SemanticDocument): void {
  drawBlocks(context, document.content)
}

export async function createQuestionBankPdf(
  prepared: PreparedQuestionBankExport,
  fontLoader: QuestionBankPdfFontLoader = browserQuestionBankPdfFonts,
): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  document.registerFontkit(fontkit)
  const [regular, bold, italic, boldItalic, mono] = await Promise.all([
    fontLoader('regular'),
    fontLoader('bold'),
    fontLoader('italic'),
    fontLoader('boldItalic'),
    fontLoader('mono'),
  ])
  const fonts: Fonts = {
    regular: await document.embedFont(regular, { subset: true }),
    bold: await document.embedFont(bold, { subset: true }),
    italic: await document.embedFont(italic, { subset: true }),
    boldItalic: await document.embedFont(boldItalic, { subset: true }),
    mono: await document.embedFont(mono, { subset: true }),
  }
  const context: Context = {
    document,
    page: document.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    fonts,
    y: PAGE_HEIGHT - MARGIN,
    pageNumber: 1,
  }
  document.setTitle(prepared.record.bank.name)
  document.setSubject(
    `Teacher Question Bank containing answers; format ${prepared.record.formatVersion}; SHA-256 ${prepared.record.integrity.digest.slice(0, 12)}`,
  )
  document.setCreator('Test Parrot')
  drawText(context, prepared.record.bank.name || 'Untitled Question Bank', {
    font: 'bold',
    size: 21,
    line: 26,
  })
  context.y -= 8
  drawText(context, 'Teacher Question Bank containing answers', {
    font: 'bold',
    size: 13,
    line: 18,
  })
  drawText(context, 'This Question Bank can be imported into Test Parrot.', {
    font: 'italic',
  })
  drawText(
    context,
    'Import data may be lost if this PDF is rewritten or printed.',
    { font: 'italic' },
  )
  context.y -= 8
  drawText(
    context,
    `${prepared.record.bank.questions.length} ${prepared.record.bank.questions.length === 1 ? 'Question' : 'Questions'}`,
    { font: 'bold', size: 12 },
  )
  context.y -= 12

  for (const [index, question] of prepared.record.bank.questions.entries()) {
    ensure(context, 90)
    drawText(context, `Question ${index + 1}`, {
      font: 'bold',
      size: 15,
      line: 20,
    })
    drawLabel(
      context,
      'Question Type',
      question.type === 'multiple-choice' ? 'Multiple Choice' : 'Short Answer',
    )
    drawLabel(
      context,
      'Difficulty',
      question.difficulty
        ? question.difficulty[0]!.toUpperCase() + question.difficulty.slice(1)
        : 'Unspecified',
    )
    drawLabel(context, 'Topics', question.topics?.join(', ') || 'None')
    context.y -= 4
    drawDocument(context, question.stem)
    if (question.choices) {
      question.choices.forEach((choice, choiceIndex) => {
        drawPieces(
          context,
          [
            {
              text: `${String.fromCharCode(65 + choiceIndex)}. `,
              font: 'bold',
              size: BODY_SIZE,
            },
            ...inlinePieces(choice.content.content),
            ...(choice.correct
              ? [
                  {
                    text: '  (Correct answer)',
                    font: 'bold' as const,
                    size: BODY_SIZE,
                  },
                ]
              : []),
          ],
          { x: MARGIN + 18, width: CONTENT_WIDTH - 18 },
        )
      })
    }
    if (question.suggestedAnswer) {
      context.y -= 3
      drawText(context, 'Suggested Answer', { font: 'bold', size: 12 })
      drawDocument(context, question.suggestedAnswer)
    }
    context.y -= 14
  }

  // Put attachment metadata on the file specification and the MIME type on
  // the embedded stream. pdf-lib also places this one file specification in
  // both the EmbeddedFiles name tree and the catalog AF array.
  await document.attach(prepared.recordBytes, QUESTION_BANK_ATTACHMENT_NAME, {
    mimeType: 'application/json',
    description: QUESTION_BANK_ATTACHMENT_DESCRIPTION,
    afRelationship: AFRelationship.Source,
  })
  return document.save({ useObjectStreams: false })
}

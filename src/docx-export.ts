// The DOCX Export Adapter.
//
// The second translator from a Layout Plan into a real output format, beside
// the print adapter in `exam-page.tsx`. It accepts prepared plans and nothing
// else: there is no `Exam` and no `Version` in this file, so it cannot
// rediscover document semantics or pagination of its own. What a plan says is
// on page three, in what order, under which number and letter, is what that
// page of the Word document says.
//
// An export is an ordered collection of standalone documents — a student test
// or an answer key, one per Generated Version — and they are packaged into one
// combined file in exactly the order `export-preparation.ts` prepared them.
// Nothing here reorders them, generates one, or decides how many there are.
//
// The plans' pages are serialized explicitly. Each planned page becomes one
// Word section that starts on a new page and carries the header variant, footer
// number and items the plan assigned it, rather than handing Word a flat stream
// of paragraphs and hoping it repaginates the same way. A standalone document's
// first page is a section like any other, so it starts on a new sheet and its
// footer restarts at the number its own plan gave it.
//
// This module is loaded dynamically by App so the DOCX writer and its ZIP
// machinery do not become part of the application's initial bundle. Image bytes
// are output-specific packaging and are resolved here, through an injected
// `MediaLoader`, so the shared plan can stay format-neutral and testable.

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Math as OfficeMath,
  MathRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
  type ISectionOptions,
  type ParagraphChild,
} from 'docx'
import { versionRange } from './export-preparation'
import {
  CHOICE_AREA_WIDTH,
  type AnswerKeyEntryItem,
  type AnswerKeySectionItem,
  type ChoiceGrid,
  type IdentityField,
  US_LETTER,
  type LayoutPlan,
  type PageFurniture,
  type PageItem,
  type PlannedPage,
  type QuestionItem,
} from './export-plan'
import type { ProseMirrorJSON } from './question-doc'

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// ---------------------------------------------------------------------------
// Units
//
// The plan is in CSS pixels at 96dpi, the same as the sheet the print adapter
// lays out. Word measures in twips — 1440 to the inch, so exactly 15 to the
// pixel — and images in half-points or pixels depending on where they sit.

const TWIPS_PER_PX = 15

function twips(px: number): number {
  return Math.round(px * TWIPS_PER_PX)
}

// The number column of `.exam-question` in styles.css: the width print gives a
// question's number and answer blank, plus the grid gap beside it. A question's
// body hangs off it, so a continued piece's text stays where the first piece's
// text was.
const QUESTION_INDENT = twips(92 + 6)

// ---------------------------------------------------------------------------
// Media
//
// The Export Document keeps an image's identity — its source, its alt text, its
// caption. Actual bytes are output-specific packaging, so they are loaded here
// and only here, through a dependency the app fills with `fetch` and tests fill
// with fixtures.

/** One image, decoded far enough to be packaged and sized. */
export type ExportImage = {
  data: Uint8Array
  /** The image kinds Word can hold. */
  type: 'png' | 'jpg' | 'gif' | 'bmp'
  /** Intrinsic size in px, before the plan's content width caps it. */
  width: number
  height: number
}

/** Resolves an image source to bytes, or to `null` when it cannot be read. */
export type MediaLoader = (src: string) => Promise<ExportImage | null>

const IMAGE_TYPES: Record<string, ExportImage['type']> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
}

/** Anything the browser can decode but Word cannot hold — a WebP or an AVIF a
 *  teacher uploaded — is re-encoded, so an ordinary upload does not come out of
 *  export as a line of text about a picture. */
async function asPng(bitmap: ImageBitmap): Promise<Uint8Array | null> {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  const png = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  )
  return png ? new Uint8Array(await png.arrayBuffer()) : null
}

/** The app's loader: the same URL the page's `<img>` resolves, which for a
 *  teacher's own upload is served out of Cache Storage by the image worker. */
export const browserMedia: MediaLoader = async (src) => {
  try {
    const response = await fetch(src)
    if (!response.ok) return null
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    const type = IMAGE_TYPES[blob.type.toLowerCase()]
    const data = type
      ? new Uint8Array(await blob.arrayBuffer())
      : await asPng(bitmap)
    const image = data
      ? {
          data,
          type: type ?? ('png' as const),
          width: bitmap.width,
          height: bitmap.height,
        }
      : null
    bitmap.close()
    return image
  } catch {
    return null
  }
}

/** Every image source the plans refer to, in first-appearance order. */
export function imageSourcesOf(plans: readonly LayoutPlan[]): string[] {
  const sources: string[] = []
  const seen = new Set<string>()
  const visit = (node: ProseMirrorJSON) => {
    if (node.type === 'image' || node.type === 'image-block') {
      const src = stringOf(attrsOf(node).src)
      if (src && !seen.has(src)) {
        seen.add(src)
        sources.push(src)
      }
    }
    for (const child of childrenOf(node)) visit(child)
  }
  for (const plan of plans) {
    for (const page of plan.pages) {
      for (const item of page.items) {
        if (item.kind !== 'question') continue
        for (const block of item.stem) visit(block)
        for (const row of item.grid?.cells ?? []) {
          for (const cell of row) if (cell) visit(cell.node)
        }
      }
    }
  }
  return sources
}

async function loadImages(
  plans: readonly LayoutPlan[],
  media: MediaLoader,
): Promise<Map<string, ExportImage>> {
  const sources = imageSourcesOf(plans)
  const loaded = await Promise.all(sources.map((src) => media(src)))
  return new Map(
    sources.flatMap((src, index) => {
      const image = loaded[index]
      return image ? [[src, image] as const] : []
    }),
  )
}

// ---------------------------------------------------------------------------
// Document node helpers

type MutableRunOptions = {
  -readonly [Key in keyof IRunOptions]: IRunOptions[Key]
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

// ---------------------------------------------------------------------------
// Numbering
//
// A list is structural content, not a paragraph with a bullet typed in front of
// it. Every list in the document gets its own numbering instance so an ordered
// list restarts at the number it was authored to start at, and so two lists in
// one question cannot continue each other's count.

const BULLET_GLYPHS = ['•', '◦', '▪', '•', '◦']
const ORDERED_FORMATS = [
  LevelFormat.DECIMAL,
  LevelFormat.LOWER_LETTER,
  LevelFormat.LOWER_ROMAN,
  LevelFormat.DECIMAL,
  LevelFormat.LOWER_LETTER,
]
const LIST_LEVELS = 5

type NumberingConfig = NonNullable<
  ConstructorParameters<typeof Document>[0]['numbering']
>['config']

type MutableNumberingConfig = NumberingConfig[number][]

// Levels are indented like the print view's own nesting: each step in by half an
// inch, with the marker hanging back out of the text block.
function levelsOf(ordered: boolean, start: number) {
  return Array.from({ length: LIST_LEVELS }, (_unused, level) => ({
    level,
    format: ordered ? ORDERED_FORMATS[level]! : LevelFormat.BULLET,
    text: ordered ? `%${level + 1}.` : BULLET_GLYPHS[level]!,
    alignment: AlignmentType.LEFT,
    start: level === 0 ? start : 1,
    style: {
      paragraph: {
        indent: { left: 720 * (level + 1), hanging: 360 },
      },
    },
  }))
}

// One registry per document build. It hands out a reference per list occurrence
// and remembers the configuration each one needs, which is why the `Document` is
// constructed after its children rather than before them.
class Numbering {
  readonly config: MutableNumberingConfig = []

  reference(ordered: boolean, start: number): string {
    const reference = `exam-list-${this.config.length}`
    this.config.push({ reference, levels: levelsOf(ordered, start) })
    return reference
  }
}

// ---------------------------------------------------------------------------
// Inline content

function markedText(node: ProseMirrorJSON): ParagraphChild {
  const marks = Array.isArray(node.marks) ? (node.marks as ProseMirrorJSON[]) : []
  const options: MutableRunOptions = { text: stringOf(node.text) }
  let href = ''

  for (const mark of marks) {
    switch (mark.type) {
      case 'strong':
        options.bold = true
        break
      case 'emphasis':
        options.italics = true
        break
      case 'inlineCode':
        options.font = 'Courier New'
        break
      case 'strike_through':
        options.strike = true
        break
      case 'subscript':
        options.subScript = true
        break
      case 'superscript':
        options.superScript = true
        break
      case 'link':
        href = stringOf(attrsOf(mark).href)
        options.style = 'Hyperlink'
        break
    }
  }

  const run = new TextRun(options)
  // A link is a relationship in the package, not a blue run: the destination
  // has to survive export for the linked material to remain usable.
  return href ? new ExternalHyperlink({ link: href, children: [run] }) : run
}

// Mathematics stays mathematics: a real Office Math object, so Word treats it as
// an equation and a reader can edit it as one, rather than a paragraph of text
// that happens to look like a formula.
//
// The equation's content is the authored LaTeX. Translating LaTeX into OMML's
// own structure — fractions, radicals, scripts as elements — needs a LaTeX
// parser this codebase does not have, so `\frac{a}{b}` appears inside the
// equation as it was written rather than typeset as a fraction. That is a known
// limit of this adapter, not of the plan: the source is preserved, the object is
// native, and `docs/export-testing.md` records it.
function mathRun(source: string): ParagraphChild {
  return new OfficeMath({ children: [new MathRun(source)] })
}

/** An image at its planned size: intrinsic px, capped at the width the plan
 *  gives a page's content box so a large upload cannot run off the sheet. */
function imageRun(image: ExportImage, maxWidth: number): ParagraphChild {
  const scale = image.width > maxWidth ? maxWidth / image.width : 1
  return new ImageRun({
    data: image.data,
    type: image.type,
    transformation: {
      width: Math.max(1, Math.round(image.width * scale)),
      height: Math.max(1, Math.round(image.height * scale)),
    },
  })
}

type BuildContext = {
  numbering: Numbering
  images: ReadonlyMap<string, ExportImage>
  /** The width the surrounding block gives content, in px. */
  contentWidth: number
}

function inlineChildren(
  node: ProseMirrorJSON,
  context: BuildContext,
): ParagraphChild[] {
  const result: ParagraphChild[] = []
  for (const child of childrenOf(node)) {
    switch (child.type) {
      case 'text':
        result.push(markedText(child))
        break
      case 'hardbreak':
        // An authored line break is content, not renderer-chosen wrapping.
        result.push(new TextRun({ break: 1 }))
        break
      case 'math_inline':
        result.push(mathRun(stringOf(attrsOf(child).value)))
        break
      case 'image': {
        const attrs = attrsOf(child)
        const image = context.images.get(stringOf(attrs.src))
        result.push(
          image
            ? imageRun(image, context.contentWidth)
            : new TextRun({
                text: `[Image: ${stringOf(attrs.alt, 'embedded image')}]`,
                italics: true,
              }),
        )
        break
      }
      default:
        result.push(...inlineChildren(child, context))
        break
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Block content

/** What a block inherits from the item it sits in: the run of text that must
 *  open it, how far it is indented, and which list it belongs to. */
type BlockContext = {
  /** Prepended to the first paragraph produced — the question's number line. */
  prefix?: ParagraphChild[]
  /** A hanging indent applied with that prefix, so the body aligns under itself. */
  hanging?: number
  indent: number
  list?: { reference: string; level: number }
  keepNext?: boolean
}

const BODY_SPACING = { after: 80, line: 276 }

function paragraphOptions(
  context: BlockContext,
  extra: IParagraphOptions = {},
): IParagraphOptions {
  const indent = context.list
    ? undefined
    : {
        left: context.indent || undefined,
        hanging: context.hanging || undefined,
      }
  return {
    keepLines: true,
    keepNext: context.keepNext,
    spacing: BODY_SPACING,
    indent: indent?.left || indent?.hanging ? indent : undefined,
    numbering: context.list
      ? { reference: context.list.reference, level: context.list.level }
      : undefined,
    ...extra,
  }
}

function inlineParagraph(
  node: ProseMirrorJSON,
  context: BlockContext,
  build: BuildContext,
  extra: IParagraphOptions = {},
): Paragraph {
  const children = [
    ...(context.prefix ?? []),
    ...inlineChildren(node, build),
  ]
  return new Paragraph(
    paragraphOptions(context, { children, includeIfEmpty: true, ...extra }),
  )
}

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
]

/** Blocks in order, with the opening prefix used up by the first one that
 *  actually produces something. */
function blocks(
  nodes: readonly ProseMirrorJSON[],
  context: BlockContext,
  build: BuildContext,
): (Paragraph | Table)[] {
  const result: (Paragraph | Table)[] = []
  let prefix = context.prefix
  let hanging = context.hanging
  for (const node of nodes) {
    const produced = blockOf(node, { ...context, prefix, hanging }, build)
    result.push(...produced)
    if (produced.length > 0) {
      prefix = undefined
      hanging = undefined
    }
  }
  return result
}

// Every node kind the read-only document view draws has a structural
// counterpart here. `doc-view.tsx` and this switch are the two adapter mappings
// a newly supported editor node needs before its export coverage can pass;
// anything still unrecognised falls back to its children rather than vanishing.
function blockOf(
  node: ProseMirrorJSON,
  context: BlockContext,
  build: BuildContext,
): (Paragraph | Table)[] {
  const attrs = attrsOf(node)
  switch (node.type) {
    case 'paragraph':
      return [inlineParagraph(node, context, build)]

    case 'heading': {
      const level = Math.min(Math.max(Number(attrs.level) || 1, 1), 6)
      return [
        inlineParagraph(node, context, build, { heading: HEADINGS[level - 1] }),
      ]
    }

    case 'blockquote':
      return blocks(
        childrenOf(node),
        { ...context, indent: context.indent + 360, list: undefined },
        build,
      )

    case 'bullet_list':
    case 'ordered_list': {
      const ordered = node.type === 'ordered_list'
      const reference = build.numbering.reference(
        ordered,
        ordered ? Number(attrs.order) || 1 : 1,
      )
      const level = context.list ? context.list.level + 1 : 0
      // The opening prefix belongs to the first item that prints, not to every
      // item in the list.
      let prefix = context.prefix
      let hanging = context.hanging
      return childrenOf(node).flatMap((child) => {
        const produced = blockOf(
          child,
          { ...context, prefix, hanging, list: { reference, level } },
          build,
        )
        if (produced.length > 0) {
          prefix = undefined
          hanging = undefined
        }
        return produced
      })
    }

    case 'list_item':
      return blocks(childrenOf(node), context, build)

    case 'code_block': {
      const source = childrenOf(node)
        .map((child) => stringOf(child.text))
        .join('')
      // Crepe stores display mathematics as a latex code block, exactly as the
      // read-only view reads it.
      if (stringOf(attrs.language).toLowerCase() === 'latex') {
        return [
          new Paragraph(
            paragraphOptions(context, {
              children: [...(context.prefix ?? []), mathRun(source)],
              alignment: AlignmentType.CENTER,
            }),
          ),
        ]
      }
      // Authored newlines inside a code block are content: keep them as breaks
      // rather than letting the lines run together.
      const lines = source.split('\n')
      return [
        new Paragraph(
          paragraphOptions(context, {
            children: [
              ...(context.prefix ?? []),
              ...lines.flatMap((line, index) => [
                ...(index > 0 ? [new TextRun({ break: 1 })] : []),
                new TextRun({ text: line, font: 'Courier New' }),
              ]),
            ],
            shading: { fill: 'F4F4F5' },
          }),
        ),
      ]
    }

    case 'image': {
      // An inline image standing alone as a block still prints on its own line.
      const image = build.images.get(stringOf(attrs.src))
      return [
        new Paragraph(
          paragraphOptions(context, {
            children: [
              ...(context.prefix ?? []),
              image
                ? imageRun(image, build.contentWidth)
                : new TextRun({
                    text: `[Image: ${stringOf(attrs.alt, 'embedded image')}]`,
                    italics: true,
                  }),
            ],
          }),
        ),
      ]
    }

    case 'image-block': {
      const caption = stringOf(attrs.caption)
      const image = build.images.get(stringOf(attrs.src))
      const figure = new Paragraph(
        paragraphOptions(context, {
          children: [
            ...(context.prefix ?? []),
            image
              ? imageRun(image, build.contentWidth)
              : new TextRun({
                  text: `[Image: ${caption || 'embedded image'}]`,
                  italics: true,
                }),
          ],
        }),
      )
      if (!caption) return [figure]
      return [
        figure,
        new Paragraph(
          paragraphOptions(
            { ...context, prefix: undefined, hanging: undefined },
            { children: [new TextRun({ text: caption, italics: true, size: 18 })] },
          ),
        ),
      ]
    }

    case 'hr':
      return [
        new Paragraph(
          paragraphOptions(context, {
            children: context.prefix ?? [],
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' },
            },
          }),
        ),
      ]

    case 'table':
      // A table cannot hold a run, so an opening prefix — a question's number
      // line, a choice's letter — takes a line of its own above it and is kept
      // with it.
      return [
        ...(context.prefix
          ? [
              new Paragraph(
                paragraphOptions(context, { children: context.prefix, keepNext: true }),
              ),
            ]
          : []),
        documentTable(node, context, build),
      ]

    // A row outside a table is malformed; render its cells rather than lose them.
    case 'table_header_row':
    case 'table_row':
      return blocks(childrenOf(node), context, build)

    default: {
      const children = childrenOf(node)
      return children.length > 0
        ? blocks(children, context, build)
        : [inlineParagraph(node, context, build)]
    }
  }
}

const CELL_BORDER = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: '999999',
}

// A table stays a table: the same rows, the same cells, header cells still
// marked. Flattening one into tab-separated paragraphs loses the topology that
// made the question readable.
function documentTable(
  node: ProseMirrorJSON,
  context: BlockContext,
  build: BuildContext,
): Table {
  const rows = childrenOf(node).filter(
    (row) => row.type === 'table_row' || row.type === 'table_header_row',
  )
  const columns = rows.reduce(
    (widest, row) => Math.max(widest, childrenOf(row).length),
    1,
  )
  const cellWidth = build.contentWidth / columns
  return new Table({
    width: { size: twips(build.contentWidth), type: WidthType.DXA },
    indent: context.indent
      ? { size: context.indent, type: WidthType.DXA }
      : undefined,
    rows: rows.map(
      (row) =>
        new TableRow({
          tableHeader: row.type === 'table_header_row',
          children: Array.from({ length: columns }, (_unused, column) => {
            const cell = childrenOf(row)[column]
            const header =
              row.type === 'table_header_row' || cell?.type === 'table_header'
            const content = cell
              ? blocks(
                  childrenOf(cell),
                  { indent: 0, keepNext: context.keepNext },
                  { ...build, contentWidth: cellWidth },
                )
              : []
            return new TableCell({
              width: { size: twips(cellWidth), type: WidthType.DXA },
              shading: header ? { fill: 'F1F1F1' } : undefined,
              borders: {
                top: CELL_BORDER,
                bottom: CELL_BORDER,
                left: CELL_BORDER,
                right: CELL_BORDER,
              },
              children: content.length > 0 ? content : [new Paragraph({})],
            })
          }),
        }),
    ),
  })
}

// ---------------------------------------------------------------------------
// Page items

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const NO_BORDERS = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
  insideHorizontal: NO_BORDER,
  insideVertical: NO_BORDER,
}

// The grid is a real borderless table with the plan's own topology: the plan's
// column count, the plan's rows, the plan's cells — including the empty ones
// where the last column runs out of answers. On paper this is a layout, not a
// table, which is why every border is off.
function choiceGridTable(grid: ChoiceGrid, build: BuildContext): Table {
  const cellWidth = CHOICE_AREA_WIDTH / grid.columns
  return new Table({
    width: { size: twips(CHOICE_AREA_WIDTH), type: WidthType.DXA },
    indent: { size: QUESTION_INDENT, type: WidthType.DXA },
    borders: NO_BORDERS,
    rows: grid.cells.map(
      (row) =>
        new TableRow({
          children: row.map((choice) => {
            const content = choice
              ? blocks(
                  childrenOf(choice.node),
                  {
                    indent: 0,
                    prefix: [new TextRun({ text: `${choice.letter}.\t` })],
                    hanging: 288,
                  },
                  { ...build, contentWidth: cellWidth },
                )
              : []
            return new TableCell({
              width: { size: twips(cellWidth), type: WidthType.DXA },
              borders: NO_BORDERS,
              children: content.length > 0 ? content : [new Paragraph({})],
            })
          }),
        }),
    ),
  })
}

// A question, or the piece of one this page carries. Only the first piece prints
// the number line and the answer blank — the same rule the print adapter draws
// by, taken from the same planned item rather than decided again here.
function questionContent(
  item: QuestionItem,
  build: BuildContext,
): (Paragraph | Table)[] {
  const prefix: ParagraphChild[] = item.numbered
    ? [
        new TextRun({
          text: item.question.answerBlank
            ? `_______  ${item.question.number}.\t`
            : `${item.question.number}.\t`,
        }),
      ]
    : []
  const context: BlockContext = {
    indent: QUESTION_INDENT,
    hanging: item.numbered ? QUESTION_INDENT : undefined,
    prefix: item.numbered ? prefix : undefined,
  }

  const stem =
    item.stem.length > 0
      ? blocks(item.stem, context, build)
      : item.numbered
        ? [new Paragraph(paragraphOptions(context, { children: prefix }))]
        : []

  return [...stem, ...(item.grid ? [choiceGridTable(item.grid, build)] : [])]
}

// The answer key, in Word.
//
// The key's own heading and its per-section groupings are headings the same way
// the test's section headings are, and one entry is one line: the question's
// number, then the letter this Version's ordering earned — in bold, as print
// draws it. The plan decided every one of those; nothing here reads a choice.

const ANSWER_KEY_TITLE = 'Answer Section'

function answerKeySection(item: AnswerKeySectionItem): Paragraph {
  return new Paragraph({
    text: item.title,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 100, after: 40 },
  })
}

function answerKeyEntry(item: AnswerKeyEntryItem): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${item.number}. ` }),
      // A free-response question still takes a line, so the key's numbering
      // matches the paper's; it simply has no letter to print.
      ...(item.letter ? [new TextRun({ text: item.letter, bold: true })] : []),
    ],
  })
}

function itemContent(
  item: PageItem,
  build: BuildContext,
): (Paragraph | Table)[] {
  switch (item.kind) {
    case 'section-heading':
      return [
        new Paragraph({
          text: item.title,
          heading: HeadingLevel.HEADING_1,
          // The plan's own keep decision, not a second guess at one.
          keepNext: item.keepWithNext,
          spacing: { before: 120, after: 60 },
        }),
        new Paragraph({
          children: [new TextRun({ text: item.instructions, italics: true })],
          keepNext: item.keepWithNext,
          spacing: { after: 160 },
        }),
      ]
    case 'question':
      return questionContent(item, build)
    case 'answer-key-heading':
      return [
        new Paragraph({
          text: ANSWER_KEY_TITLE,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 120, after: 60 },
        }),
      ]
    case 'answer-key-section':
      return [answerKeySection(item)]
    case 'answer-key-entry':
      return [answerKeyEntry(item)]
    default: {
      const unreachable: never = item
      return unreachable
    }
  }
}

// ---------------------------------------------------------------------------
// Page furniture
//
// Read straight off the plan, the same as the print adapter reads it: the
// identity fields the page offers, whether it repeats the title, which version
// it names, and what its footer prints. Nothing here decides what a header
// variant means.

// Word has no line-leader, so an identity blank is an underlined run of spaces —
// the closest editable equivalent of print's `.identity-blank` rule.
const IDENTITY_BLANK_WIDTH = 22
const SHORT_BLANK_WIDTH = 12

function identityField(field: IdentityField, first: boolean): ParagraphChild[] {
  return [
    new TextRun({ text: `${first ? '' : '\t'}${field}: ` }),
    new TextRun({
      text: ' '.repeat(field === 'Name' ? IDENTITY_BLANK_WIDTH : SHORT_BLANK_WIDTH),
      underline: {},
    }),
  ]
}

function headerParagraphs(furniture: PageFurniture): Paragraph[] {
  const identity = furniture.identityFields.flatMap((field, index) =>
    identityField(field, index === 0),
  )
  return [
    new Paragraph({
      children: [
        ...identity,
        new TextRun({ text: identity.length > 0 ? `\t${furniture.versionLabel}` : furniture.versionLabel }),
      ],
      alignment: identity.length > 0 ? undefined : AlignmentType.RIGHT,
      spacing: { after: 60 },
    }),
    ...(furniture.title === null
      ? []
      : [
          new Paragraph({
            text: furniture.title,
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
          }),
        ]),
  ]
}

// The plan already numbered the page — including restarting at 1 for the answer
// key — so the footer prints that number rather than asking Word for a field
// whose count would be the whole document's.
function footerParagraph(furniture: PageFurniture): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: String(furniture.pageNumber) })],
    alignment: AlignmentType.CENTER,
  })
}

// ---------------------------------------------------------------------------
// The document

/** One Word section per planned page. Sections default to starting on a new
 *  page, which is what serializes the plan's pagination instead of leaving Word
 *  to discover one of its own. */
function sectionOf(
  page: PlannedPage,
  plan: LayoutPlan,
  build: BuildContext,
): ISectionOptions {
  return {
    properties: {
      page: {
        size: {
          width: twips(plan.pageSize.width),
          height: twips(plan.pageSize.height),
        },
        margin: {
          top: twips(plan.pageSize.margin),
          right: twips(plan.pageSize.margin),
          bottom: twips(plan.pageSize.margin),
          left: twips(plan.pageSize.margin),
        },
      },
    },
    headers: { default: new Header({ children: headerParagraphs(page.furniture) }) },
    footers: { default: new Footer({ children: [footerParagraph(page.furniture)] }) },
    children: page.items.flatMap((item) => itemContent(item, build)),
  }
}

/**
 * The prepared plans as one Word document: every standalone student test and
 * answer key, in the order preparation put them in, packaged together.
 *
 * Synchronous and pure — every image the plans refer to has already been
 * resolved into `images`, so this can be asserted against in an ordinary test.
 */
export function createExamDocxDocument(
  plans: readonly LayoutPlan[],
  images: ReadonlyMap<string, ExportImage> = new Map(),
): Document {
  const numbering = new Numbering()
  const first = plans[0]
  const build: BuildContext = {
    numbering,
    images,
    contentWidth: first?.pageSize.contentWidth ?? US_LETTER.contentWidth,
  }
  // Sections first: the list configurations only exist once the content that
  // uses them has been built.
  const sections = plans.flatMap((plan) =>
    plan.pages.map((page) => sectionOf(page, plan, build)),
  )
  // Which papers the file holds, from the plans themselves rather than from a
  // second count of the Versions someone asked for.
  const labels = [...new Set(plans.map((plan) => plan.version.letter))]
  return new Document({
    title: first?.title ?? '',
    description: `${labels.length > 1 ? 'Versions' : 'Version'} ${versionRange(labels)}`,
    creator: 'Test Parrot',
    numbering: { config: numbering.config },
    sections: sections.length > 0 ? sections : [{ children: [] }],
  })
}

export async function createExamDocx(
  plans: readonly LayoutPlan[],
  media: MediaLoader = browserMedia,
): Promise<Blob> {
  const images = await loadImages(plans, media)
  const blob = await Packer.toBlob(createExamDocxDocument(plans, images))
  return blob.type === DOCX_MIME ? blob : new Blob([blob], { type: DOCX_MIME })
}

/** Hands the finished package to the browser as a download. Separate from
 *  building it so the application can package while its export dialog is still
 *  up, and start the download only once the dialog has closed. */
export function saveDocxFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

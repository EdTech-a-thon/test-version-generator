// The DOCX Export Adapter.
//
// The second translator from a Layout Plan into a real output format, beside
// the print adapter in `exam-page.tsx`. It accepts prepared plans and nothing
// else: there is no `Exam` or mutable authoring state in this file, so it cannot
// rediscover document semantics or pagination of its own. What a plan says is
// on page three, in what order, under which number and letter, is what that
// page of the Word document says.
//
// An export is the selected canonical documents for one recorded output:
// the student test before its answer key when both are selected. They are
// packaged in exactly the order `export-preparation.ts` prepared them. Nothing
// here reorders them, resolves identity, or decides Content Selection.
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
  LeaderType,
  LevelFormat,
  LineRuleType,
  Math as OfficeMath,
  MathRun,
  Packer,
  Paragraph,
  Tab,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
  type ISectionOptions,
  type ParagraphChild,
  type TabStopDefinition,
} from 'docx'
import { arrangementRange } from './export-preparation'
import { EXAM_FONT, halfPointsOf } from './export-typography'
import {
  authoredImageRatio,
  authoredImageWidth,
  browserMedia,
  imageSourcesOf,
  loadExportImages,
  questionNumberForMedia,
  RequiredMediaError,
  type ExportImage,
  type MediaLoader,
} from './export-media'
import {
  CHOICE_AREA_WIDTH,
  questionIndentOf,
  MATCHING_BANK_WIDTH,
  PAGE_CONTENT_WIDTH,
  printsNumberLine,
  PART_INDENT,
  type AnswerKeyEntryItem,
  type AnswerKeySectionItem,
  type ChoiceGrid,
  type IdentityField,
  US_LETTER,
  type LayoutPlan,
  type MatchingSet,
  type PageFurniture,
  type PageItem,
  type PlannedBankAnswer,
  type PlannedPage,
  type PlannedPart,
  type PlannedWorkSpace,
  type QuestionItem,
} from './export-plan'
import { DIFFICULTY_LABELS, WORK_SPACE_LINE_PITCH } from './exam'
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

/** A table's grid, in twips: the widths its cells are, column by column. Left
 *  out, the writer emits a 100-twip column per cell, and every reader that lays
 *  a table out from its grid rather than its cells squeezes each column to a
 *  sliver — one letter to a line. */
function gridOf(columns: readonly number[]): number[] {
  return columns.map(twips)
}

// The number column of `.exam-question` in styles.css: the width print gives a
// question's number and answer blank, plus the grid gap beside it. A question's
// body hangs off it, so a continued piece's text stays where the first piece's
// text was. A Short Answer question's column is narrower — see
// `questionIndentOf` — and this is the width every other question uses.
const QUESTION_INDENT_PX = questionIndentOf({ type: 'multiple-choice' })
const QUESTION_INDENT = twips(QUESTION_INDENT_PX)
/** Where the key's answer column starts: past `.answer-key-entry`'s 42px
 *  number column and its 8px gap. */
const ANSWER_KEY_ANSWER_INDENT = twips(42 + 8)

export {
  browserMedia,
  imageSourcesOf,
  isRequiredMediaError,
  RequiredMediaError,
  type ExportImage,
  type MediaLoader,
} from './export-media'

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

/** An image at its planned size: intrinsic px scaled by the size the teacher
 *  dragged it to, capped at the width the plan gives a page's content box so a
 *  large upload cannot run off the sheet. */
function imageRun(image: ExportImage, maxWidth: number, ratio = 1): ParagraphChild {
  const width = authoredImageWidth(image.width, maxWidth, ratio)
  const scale = width / image.width
  return new ImageRun({
    data: image.data,
    type: image.type,
    transformation: {
      width: Math.max(1, Math.round(width)),
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
              ? imageRun(image, build.contentWidth, authoredImageRatio(attrs))
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
            { children: [new TextRun({ text: caption, italics: true, size: halfPointsOf('small') })] },
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
    columnWidths: gridOf(Array.from({ length: columns }, () => cellWidth)),
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
function choiceGridTable(
  grid: ChoiceGrid,
  build: BuildContext,
  areaWidth = CHOICE_AREA_WIDTH,
  indentPx = QUESTION_INDENT_PX,
): Table {
  const cellWidth = areaWidth / grid.columns
  return new Table({
    width: { size: twips(areaWidth), type: WidthType.DXA },
    columnWidths: gridOf(Array.from({ length: grid.columns }, () => cellWidth)),
    indent: { size: twips(indentPx), type: WidthType.DXA },
    borders: NO_BORDERS,
    rows: grid.cells.map(
      (row) =>
        new TableRow({
          children: row.map((choice) => {
            const content = choice
              ? blocks(
                  childrenOf(choice.node),
                  {
                    indent: 288,
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

// A matching set, with the plan's own layout. The prompts are paragraphs
// opened by their blank and number, hanging off the page's own number column
// so they line up with the questions around them; each Word Bank answer is
// opened by its letter. A short bank is the right cell of a borderless one-row
// table spanning the full content width, the prompts stacked in its left cell;
// a long bank is a borderless grid above the prompts with the plan's own
// topology, drawn the way a choice grid is.
function matchingContent(
  set: MatchingSet,
  build: BuildContext,
): (Paragraph | Table)[] {
  const cell = (width: number, content: (Paragraph | Table)[]) =>
    new TableCell({
      width: { size: twips(width), type: WidthType.DXA },
      borders: NO_BORDERS,
      children: content.length > 0 ? content : [new Paragraph({})],
    })
  const prompts = (contentWidth: number) =>
    set.prompts.flatMap((prompt) =>
      blocks(
        childrenOf(prompt.node),
        {
          indent: QUESTION_INDENT,
          hanging: QUESTION_INDENT,
          prefix: [new TextRun({ text: `_______  ${prompt.number}.\t` })],
        },
        { ...build, contentWidth },
      ),
    )
  const answer = (item: PlannedBankAnswer, contentWidth: number) =>
    blocks(
      childrenOf(item.node),
      { indent: 288, prefix: [new TextRun({ text: `${item.letter}.\t` })], hanging: 288 },
      { ...build, contentWidth },
    )

  if (set.bankGrid) {
    const cellWidth = CHOICE_AREA_WIDTH / set.bankGrid.columns
    const grid = new Table({
      width: { size: twips(CHOICE_AREA_WIDTH), type: WidthType.DXA },
      columnWidths: gridOf(Array.from({ length: set.bankGrid.columns }, () => cellWidth)),
      indent: { size: QUESTION_INDENT, type: WidthType.DXA },
      borders: NO_BORDERS,
      rows: set.bankGrid.cells.map(
        (row) =>
          new TableRow({
            children: row.map((item) =>
              cell(cellWidth, item ? answer(item, cellWidth) : []),
            ),
          }),
      ),
    })
    return [grid, ...prompts(PAGE_CONTENT_WIDTH - QUESTION_INDENT_PX)]
  }

  const itemsWidth = PAGE_CONTENT_WIDTH - MATCHING_BANK_WIDTH
  return [
    new Table({
      width: { size: twips(PAGE_CONTENT_WIDTH), type: WidthType.DXA },
      columnWidths: gridOf([itemsWidth, MATCHING_BANK_WIDTH]),
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          children: [
            cell(itemsWidth, prompts(itemsWidth - QUESTION_INDENT_PX)),
            cell(
              MATCHING_BANK_WIDTH,
              set.bank.flatMap((item) => answer(item, MATCHING_BANK_WIDTH)),
            ),
          ],
        }),
      ],
    }),
  ]
}

// A Short Answer question's work space, at the plan's own height. Word has no
// empty box of a given height, so a blank space is one empty paragraph whose
// exact line height is that height, and a lined space is one empty paragraph
// per rule, each exactly one pitch tall with its rule as a bottom border —
// the border's own half point taken out of the line so twenty rules still add
// up to the planned height. Anything left under the last rule, which only a
// space filling its page can have, is a blank paragraph of that remainder.
// Both carry a paragraph style of their own, which is what lets the package be
// read back as a work space rather than as a run of empty paragraphs.
export const WORK_SPACE_STYLES = {
  blank: 'WorkSpace',
  lines: 'WorkSpaceLines',
} as const

const WORK_SPACE_RULE_TWIPS = 10

function workSpaceParagraphs(space: PlannedWorkSpace, indentTwips: number): Paragraph[] {
  if (space.height <= 0) return []
  const style = WORK_SPACE_STYLES[space.style]
  const exactly = (heightTwips: number) => ({
    before: 0,
    after: 0,
    line: Math.max(1, heightTwips),
    lineRule: LineRuleType.EXACT,
  })
  const indent = { left: indentTwips }
  const ruled = space.style === 'lines' ? space.lines : 0
  const paragraphs = Array.from({ length: ruled }, () =>
    new Paragraph({
      style,
      indent,
      spacing: exactly(twips(WORK_SPACE_LINE_PITCH) - WORK_SPACE_RULE_TWIPS),
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 4, color: '8F847A', space: 0 },
      },
    }),
  )
  const remainder = space.height - ruled * WORK_SPACE_LINE_PITCH
  if (remainder >= 1) {
    paragraphs.push(new Paragraph({ style, indent, spacing: exactly(twips(remainder)) }))
  }
  return paragraphs
}

// A question, or the piece of one this page carries. Only the first piece prints
// the number line and the answer blank — the same rule the print adapter draws
// by, taken from the same planned item rather than decided again here.
function questionContent(
  item: QuestionItem,
  build: BuildContext,
): (Paragraph | Table)[] {
  const numbered = printsNumberLine(item)
  const indent = twips(questionIndentOf(item.question))
  const prefix: ParagraphChild[] = numbered
    ? [
        new TextRun({
          text: item.question.answerBlank
            ? `_______  ${item.question.number}.\t`
            : `${item.question.number}.\t`,
        }),
      ]
    : []
  const context: BlockContext = {
    indent,
    hanging: numbered ? indent : undefined,
    prefix: numbered ? prefix : undefined,
  }

  const stem =
    item.stem.length > 0
      ? blocks(item.stem, context, build)
      : numbered
        ? [new Paragraph(paragraphOptions(context, { children: prefix }))]
        : []

  return [
    ...stem,
    ...(item.grid ? [choiceGridTable(item.grid, build)] : []),
    ...(item.matching ? matchingContent(item.matching, build) : []),
    ...(item.workSpace ? workSpaceParagraphs(item.workSpace, indent) : []),
    ...(item.parts ?? []).flatMap((part) =>
      partContent(part, questionIndentOf(item.question), build),
    ),
  ]
}

// A Multipart question's Part, one level in: its letter hanging off its own letter column inside the Multipart question's body,
// then its choice grid or its work space, as a question of its kind prints.
function partContent(
  part: PlannedPart,
  multipartIndentPx: number,
  build: BuildContext,
): (Paragraph | Table)[] {
  const indentPx = multipartIndentPx + PART_INDENT
  const indent = twips(indentPx)
  const prefix: ParagraphChild[] = [
    new TextRun({
      text: `${part.letter}.\t`,
    }),
  ]
  const context: BlockContext = {
    indent,
    hanging: twips(PART_INDENT),
    prefix,
  }
  const stem = blocks(part.stem, context, { ...build, contentWidth: PAGE_CONTENT_WIDTH - indentPx })
  return [
    ...(stem.length > 0 ? stem : [new Paragraph(paragraphOptions(context, { children: prefix }))]),
    ...(part.grid
      ? [choiceGridTable(part.grid, build, PAGE_CONTENT_WIDTH - indentPx, indentPx)]
      : []),
    ...(part.workSpace ? workSpaceParagraphs(part.workSpace, indent) : []),
  ]
}

// The answer key, in Word.
//
// The key's own heading and its per-section groupings are headings the same way
// the test's section headings are, and one entry is one line: the question's
// number, then the letter this arrangement earned — in bold, as print
// draws it. The plan decided every one of those; nothing here reads a choice.

const ANSWER_KEY_TITLE = 'Answer Section'

function answerKeySection(item: AnswerKeySectionItem): Paragraph {
  return new Paragraph({
    text: item.title,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 100, after: 40 },
  })
}

function answerKeyEntry(item: AnswerKeyEntryItem, build: BuildContext): (Paragraph | Table)[] {
  const metadata = [
    ...(item.difficulty ? [{ label: DIFFICULTY_LABELS[item.difficulty], fill: 'E6F0E3' }] : []),
    ...(item.topics ?? []).map((topic) => ({ label: topic, fill: 'F2E6D8' })),
  ]
  const entry = new Paragraph({
    children: [
      new TextRun({ text: `${item.number}. ` }),
      // A free-response question still takes a line, so the key's numbering
      // matches the paper's; it simply has no letter to print.
      ...(item.letter ? [new TextRun({ text: item.letter, bold: true })] : []),
      ...metadata.map(({ label, fill }) =>
        new TextRun({ text: ` ${label} `, size: 18, shading: { fill } }),
      ),
    ],
  })
  // A Suggested Answer starts under the blank, on the lines below the entry.
  const suggested = item.suggestedAnswer
    ? blocks(item.suggestedAnswer, { indent: ANSWER_KEY_ANSWER_INDENT }, build)
    : []
  // A Multipart question's Parts each take a line under its number: the Part's letter,
  // then its answer in bold, then any Suggested Answer beneath.
  const parts = (item.parts ?? []).flatMap((part) => [
    new Paragraph({
      indent: { left: ANSWER_KEY_ANSWER_INDENT },
      children: [
        new TextRun({ text: `${part.letter}. ` }),
        ...(part.answer ? [new TextRun({ text: part.answer, bold: true })] : []),
      ],
    }),
    ...(part.suggestedAnswer
      ? blocks(part.suggestedAnswer, { indent: ANSWER_KEY_ANSWER_INDENT + twips(32) }, build)
      : []),
  ])
  return [entry, ...suggested, ...parts]
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
          // Larger than a section title in print, so larger than Heading 1.
          children: [new TextRun({ text: ANSWER_KEY_TITLE, size: halfPointsOf('answerKeyHeading') })],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 120, after: 60 },
        }),
      ]
    case 'answer-key-section':
      return [answerKeySection(item)]
    case 'answer-key-entry':
      return answerKeyEntry(item, build)
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
// identity fields the page offers, whether it repeats the title, which output ID
// it names, and what its footer prints. Nothing here decides what a header
// variant means.

// `.page-identity` spans the content width: each field takes an equal share of
// what the output ID leaves, its blank ruled to the end of that share, the
// fields 20px apart, and the ID in bold against the right margin. Word draws the
// same thing with tab stops: an underscore leader rules each blank to its stop,
// and a right stop at the content width holds the ID.
const IDENTITY_GAP = 20
const OUTPUT_ID_STYLE = 'OutputId'
/** Room kept for the bold output ID and the gap before it. */
const IDENTITY_ID_RESERVE = 64

function identityLine(furniture: PageFurniture): Paragraph {
  // Bold by style, as `.page-id` is bold by class: page furniture, not an
  // authored strong mark.
  const id = new TextRun({ text: furniture.arrangementLabel, style: OUTPUT_ID_STYLE })
  const fields = furniture.identityFields
  if (fields.length === 0) {
    return new Paragraph({ children: [id], alignment: AlignmentType.RIGHT, spacing: { after: 60 } })
  }
  const share =
    (PAGE_CONTENT_WIDTH - IDENTITY_ID_RESERVE - IDENTITY_GAP * (fields.length - 1)) / fields.length
  const tabStops: TabStopDefinition[] = []
  const children: ParagraphChild[] = []
  fields.forEach((field: IdentityField, index) => {
    const start = index * (share + IDENTITY_GAP)
    if (index > 0) {
      tabStops.push({ type: TabStopType.LEFT, position: twips(start) })
      children.push(new TextRun({ children: [new Tab()] }))
    }
    tabStops.push({ type: TabStopType.LEFT, position: twips(start + share), leader: LeaderType.UNDERSCORE })
    children.push(new TextRun({ children: [`${field}: `, new Tab()] }))
  })
  tabStops.push({ type: TabStopType.RIGHT, position: twips(PAGE_CONTENT_WIDTH) })
  return new Paragraph({
    children: [...children, new TextRun({ children: [new Tab()] }), id],
    tabStops,
    spacing: { after: 60 },
  })
}

function headerParagraphs(furniture: PageFurniture): Paragraph[] {
  return [
    identityLine(furniture),
    ...(furniture.title === null
      ? []
      : [
          // Print sets the title flush left, as it does every heading.
          new Paragraph({
            text: furniture.title,
            heading: HeadingLevel.TITLE,
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
    children: [new TextRun({ text: String(furniture.pageNumber), size: halfPointsOf('small') })],
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
  // second count of the output IDs someone asked for.
  const labels = [...new Set(plans.map((plan) => plan.arrangement.letter))]
  return new Document({
    title: first?.title ?? '',
    description: `Output ID ${arrangementRange(labels)}`,
    creator: 'Test Parrot',
    numbering: { config: numbering.config },
    // Print's type, not Word's: with no document defaults Word falls back to
    // 10pt Times New Roman and a 28pt Title, and the exam reads a size smaller
    // than the sheet it was planned on.
    styles: {
      default: {
        document: { run: { font: EXAM_FONT, size: halfPointsOf('body') } },
        title: { run: { font: EXAM_FONT, size: halfPointsOf('title'), bold: true } },
        heading1: { run: { font: EXAM_FONT, size: halfPointsOf('sectionTitle'), bold: true } },
        heading2: { run: { font: EXAM_FONT, size: halfPointsOf('sectionTitle'), bold: true } },
      },
      characterStyles: [{ id: OUTPUT_ID_STYLE, name: 'Output ID', run: { bold: true } }],
      paragraphStyles: [
        { id: WORK_SPACE_STYLES.blank, name: 'Work Space', basedOn: 'Normal' },
        { id: WORK_SPACE_STYLES.lines, name: 'Work Space Lines', basedOn: 'Normal' },
      ],
    },
    sections: sections.length > 0 ? sections : [{ children: [] }],
  })
}

export async function createExamDocx(
  plans: readonly LayoutPlan[],
  media: MediaLoader = browserMedia,
): Promise<Blob> {
  const images = await loadExportImages(plans, media)
  const blob = await Packer.toBlob(createExamDocxDocument(plans, images))
  return blob.type === DOCX_MIME ? blob : new Blob([blob], { type: DOCX_MIME })
}

/** Publication packaging is strict: an Export Record may never be created
 * with a text fallback standing in for media it promises to preserve. The
 * lower-level adapter remains tolerant for parity diagnostics and callers that
 * explicitly want its visible fallback behavior. */
export async function createPublicationDocx(
  plans: readonly LayoutPlan[],
  media: MediaLoader = browserMedia,
): Promise<Blob> {
  const images = await loadExportImages(plans, media)
  const missing = imageSourcesOf(plans).find((source) => !images.has(source))
  if (missing) {
    throw new RequiredMediaError(questionNumberForMedia(plans, missing))
  }
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

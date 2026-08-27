// A page item, drawn.
//
// Everything that takes up vertical space on a page is drawn here, and only
// here: `exam-page.tsx` wraps these in the editing chrome a teacher clicks, and
// `dom-measure.ts` renders the same components off-screen to find out how tall
// they come out. Sharing them is what makes measurement honest — the heights
// packing is given are the heights the printer will produce, because they were
// taken from this markup.
//
// Nothing in here is interactive beyond a single optional callback, and nothing
// reads a page's furniture: a header, a footer and a page number belong to the
// page, not to the items on it.

import { DocView } from './doc-view'
import type {
  AnswerKeyEntryItem,
  AnswerKeySectionItem,
  ChoiceGrid,
  PageFurniture,
  PageHeader,
  PageItem,
  QuestionItem,
  SectionHeadingItem,
} from './export-plan'
import type { ProseMirrorJSON } from './question-doc'

/** The blocks inside a node — a choice's own paragraphs, say. */
function blocksOf(node: ProseMirrorJSON): ProseMirrorJSON[] {
  return Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
}

// The grid is drawn as a real table so that a cell's answer stays inside its
// column, and every border is off: on paper this is a layout, not a table.
export function ChoiceGridView({ grid }: { grid: ChoiceGrid }) {
  return (
    <table className="choice-grid" data-columns={grid.columns}>
      <tbody>
        {grid.cells.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((choice, columnIndex) => (
              <td key={columnIndex} className="choice-cell">
                {choice && (
                  <>
                    <span className="choice-letter">{choice.letter}.</span>
                    <DocView className="choice-body" content={blocksOf(choice.node)} />
                  </>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// A question, or the piece of one this page carries. The number column is drawn
// either way so a continued question's text stays in the same place down the
// page; only the first piece puts a number and an answer blank in it.
export function QuestionContent({ item }: { item: QuestionItem }) {
  return (
    <>
      <div className="question-number">
        {item.numbered && item.question.answerBlank && (
          <span className="answer-blank" aria-label="Answer blank" />
        )}
        {item.numbered && <span className="question-count">{item.question.number}.</span>}
      </div>
      <div className="question-body">
        <DocView className="question-stem" content={item.stem} />
        {item.grid && <ChoiceGridView grid={item.grid} />}
      </div>
    </>
  )
}

export function SectionHeadingContent({ item }: { item: SectionHeadingItem }) {
  return (
    <>
      <h2 className="section-title">{item.title}</h2>
      <p className="section-instructions">{item.instructions}</p>
    </>
  )
}

export function AnswerKeyHeading() {
  return <h2 className="answer-key-heading">Answer Section</h2>
}

export function AnswerKeySection({ item }: { item: AnswerKeySectionItem }) {
  return <h3 className="answer-key-section">{item.title}</h3>
}

export function AnswerKeyEntry({ item }: { item: AnswerKeyEntryItem }) {
  return (
    <div className="answer-key-entry">
      <span>{item.number}.</span>
      <span className="answer-key-answer" aria-label={item.letter ?? 'Blank answer'}>
        {item.letter}
      </span>
    </div>
  )
}

// The furniture at the top of a sheet, drawn from the variant packing chose.
// The first page identifies the paper and names the test; every later page
// carries just enough to reunite a dropped stack and to stop a student swapping
// a page in from another version. Neither repeats the section heading — that is
// content, and content is packed, not drawn here.
//
// Driven by the plan's own furniture rather than by a switch of its own: the
// identity fields, the repeated title and the version label are planning
// decisions, so the DOCX adapter prints exactly the same ones. The header
// variant survives only as a class, because how tall each variant is remains a
// layout constant that CSS and packing must agree on.
export function PageHeaderContent({
  header,
  furniture,
}: {
  header: PageHeader
  furniture: PageFurniture
}) {
  return (
    <header className={`page-header page-header--${header}`}>
      <div className="page-identity">
        {furniture.identityFields.map((field) => (
          <span className="identity-field" key={field}>
            {field}:
            <span className="identity-blank" />
          </span>
        ))}
        <span className="page-id">{furniture.versionLabel}</span>
      </div>
      {furniture.title !== null && (
        <h1 className="exam-title">{furniture.title}</h1>
      )}
    </header>
  )
}

// One page item at its printed size, with no handlers and no gutter — what
// `dom-measure.ts` renders off-screen to read a height back off.
//
// Exhaustive over `PageItem`: a new kind (#8's answer key) does not compile
// until it has been given a way to be drawn, and therefore measured.
export function PageItemMeasureView({ item }: { item: PageItem }) {
  switch (item.kind) {
    case 'section-heading':
      return (
        <header className="exam-section">
          <SectionHeadingContent item={item} />
        </header>
      )
    case 'question':
      return (
        <section className="exam-question">
          <QuestionContent item={item} />
        </section>
      )
    case 'answer-key-heading':
      return <AnswerKeyHeading />
    case 'answer-key-section':
      return <AnswerKeySection item={item} />
    case 'answer-key-entry':
      return <AnswerKeyEntry item={item} />
    default: {
      const unreachable: never = item
      return unreachable
    }
  }
}

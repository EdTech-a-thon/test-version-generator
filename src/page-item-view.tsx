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

import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { DifficultyBadge, TopicBadge } from './badges'
import { DocView } from './doc-view'
import {
  hasCompactNumber,
  printsNumberLine,
  type AnswerKeyEntryItem,
  type AnswerKeySectionItem,
  type ChoiceGrid,
  type MatchingSet,
  type PageFurniture,
  type PlannedBankAnswer,
  type PlannedPart,
  type PlannedWorkSpace,
  type PageHeader,
  type PageItem,
  type QuestionItem,
  type SectionHeadingItem,
} from './export-plan'
import type { ProseMirrorJSON } from './question-doc'

/** The blocks inside a node — a choice's own paragraphs, say. */
function blocksOf(node: ProseMirrorJSON): ProseMirrorJSON[] {
  return Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
}

// The grid is drawn as a real table so that a cell's answer stays inside its
// column, and every border is off: on paper this is a layout, not a table.
export function ChoiceGridView({
  grid,
  showCorrectness = false,
}: {
  grid: ChoiceGrid
  /** The Working Copy alone may reveal correctness; previews and artifacts may not. */
  showCorrectness?: boolean
}) {
  return (
    <table className="choice-grid" data-columns={grid.columns}>
      <tbody>
        {grid.cells.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((choice, columnIndex) => (
              <td
                key={columnIndex}
                className="choice-cell"
                data-correct-answer={
                  showCorrectness && choice?.correct ? 'true' : undefined
                }
              >
                {choice && (
                  <>
                    <span className="choice-letter">
                      {/* Beside the answer rather than out at the right-hand
                          margin, where it was read as belonging to the row. It
                          takes no width and paints into the gutter left of the
                          letter, so the choice grid measures and prints exactly
                          as it would without it. */}
                      {showCorrectness && choice.correct && (
                        <span
                          className="choice-correctness-marker"
                          role="img"
                          aria-label="Correct answer"
                        >
                          <Check aria-hidden="true" />
                        </span>
                      )}
                      {choice.letter}.
                    </span>
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

// A matching set. Every prompt carries its own blank and number in a column
// the width of the page's own number column, so the numbers line up with the
// questions around them; the Word Bank letters its answers by this
// arrangement's order. A short bank sits beside the prompts as one borderless
// row of two cells, each column stacking on its own so a long item never
// pushes the bank down beside it. A long bank sits above the prompts in a
// borderless grid, column-major, the way a choice grid is drawn.
function BankAnswer({ answer }: { answer: PlannedBankAnswer }) {
  return (
    <div className="matching-answer">
      <span className="matching-letter">{answer.letter}.</span>
      <DocView className="matching-body" content={blocksOf(answer.node)} />
    </div>
  )
}

export function MatchingSetView({
  set,
  showCorrectness = false,
}: {
  set: MatchingSet
  /** The Working Copy alone may reveal each prompt's letter; previews and
   *  artifacts may not. */
  showCorrectness?: boolean
}) {
  const prompts = set.prompts.map((prompt) => (
    <div className="matching-prompt" key={prompt.id}>
      <span className="matching-number">
        {/* The letter is drawn inside the blank, in colour, without taking
            any width of its own, so a set measures and prints exactly as it
            would without it. */}
        <span
          className="matching-blank"
          aria-label="Answer blank"
          data-answer={showCorrectness && prompt.letter ? prompt.letter : undefined}
        />
        <span className="matching-count">{prompt.number}.</span>
      </span>
      <DocView className="matching-body" content={blocksOf(prompt.node)} />
    </div>
  ))
  if (set.bankGrid) {
    return (
      <div className="matching-set" data-layout="above">
        <table className="matching-bank-grid" data-columns={set.bankGrid.columns}>
          <tbody>
            {set.bankGrid.cells.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((answer, columnIndex) => (
                  <td key={columnIndex} className="matching-bank-cell">
                    {answer && <BankAnswer answer={answer} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="matching-items">{prompts}</div>
      </div>
    )
  }
  return (
    <div className="matching-set" data-layout="beside">
      <table className="matching-columns">
        <tbody>
          <tr>
            <td className="matching-items">{prompts}</td>
            <td className="matching-bank">
              {set.bank.map((answer) => (
                <BankAnswer answer={answer} key={answer.id} />
              ))}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// The room a Short Answer question leaves for a student's work: exactly as tall
// as the plan says, and either empty or ruled with the plan's own count of
// lines, each one pitch tall with its rule along the bottom. Nothing is drawn
// for a question that has no room, so a zero-height space measures as nothing.
export function WorkSpaceView({ space }: { space: PlannedWorkSpace }) {
  if (space.height <= 0) return null
  return (
    <div
      className="work-space"
      data-style={space.style}
      data-lines={space.style === 'lines' ? space.lines : undefined}
      data-fill={space.fill ? 'true' : undefined}
      style={{ height: `${space.height}px` }}
    >
      {Array.from({ length: space.lines }, (_unused, index) => (
        <div className="work-space-line" key={index} />
      ))}
    </div>
  )
}

// One Part of a Multipart question, drawn the way a question of its kind is, one level
// in: a short letter column — no answer blank, for either kind — then its
// stem, its choice grid or its work space. `renderWorkSpace` lets the sheet wrap a Short Answer Part's space in
// the handle that sizes it.
export function PartContent({
  part,
  showCorrectness = false,
  renderWorkSpace,
}: {
  part: PlannedPart
  showCorrectness?: boolean
  renderWorkSpace?: (part: PlannedPart, space: PlannedWorkSpace) => ReactNode
}) {
  return (
    <div className="multipart-part-print" data-part-id={part.id} data-part-type={part.type}>
      <div className="part-letter">
        <span className="part-count">{part.letter}.</span>
      </div>
      <div className="part-body">
        <DocView className="question-stem" content={part.stem} />
        {part.grid && <ChoiceGridView grid={part.grid} showCorrectness={showCorrectness} />}
        {part.workSpace
          && (renderWorkSpace
            ? renderWorkSpace(part, part.workSpace)
            : <WorkSpaceView space={part.workSpace} />)}
      </div>
    </div>
  )
}

// A question, or the piece of one this page carries. The number column is drawn
// either way so a continued question's text stays in the same place down the
// page; only the first piece puts a number and an answer blank in it — and a
// matching set never does, since its numbers print on its prompts.
export function QuestionContent({
  item,
  showCorrectness = false,
  renderPartWorkSpace,
}: {
  item: QuestionItem
  /** Correct-answer feedback is authoring chrome, never export content. */
  showCorrectness?: boolean
  /** The sheet's own drawing of a Short Answer Part's work space, with its
   *  sizing handle; everywhere else the space is drawn plain. */
  renderPartWorkSpace?: (part: PlannedPart, space: PlannedWorkSpace) => ReactNode
}) {
  const numbered = printsNumberLine(item)
  return (
    <>
      {/* A Short Answer question has no blank to make room for, nor does a
          Multipart question, which prints none, so its column holds the
          number alone — `questionIndentOf` in export-plan.ts is the same width
          for the adapters. */}
      <div
        className={
          hasCompactNumber(item.question.type)
            ? 'question-number question-number--compact'
            : 'question-number'
        }
      >
        {numbered && item.question.answerBlank && (
          <span className="answer-blank" aria-label="Answer blank" />
        )}
        {numbered && <span className="question-count">{item.question.number}.</span>}
      </div>
      <div className="question-body">
        <DocView className="question-stem" content={item.stem} />
        {item.grid && (
          <ChoiceGridView grid={item.grid} showCorrectness={showCorrectness} />
        )}
        {item.workSpace && <WorkSpaceView space={item.workSpace} />}
        {item.parts && item.parts.length > 0 && (
          <div className="multipart-parts-print">
            {item.parts.map((part) => (
              <PartContent
                key={part.id}
                part={part}
                showCorrectness={showCorrectness}
                renderWorkSpace={renderPartWorkSpace}
              />
            ))}
          </div>
        )}
      </div>
      {item.matching && (
        <MatchingSetView set={item.matching} showCorrectness={showCorrectness} />
      )}
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
      {(item.difficulty || (item.topics?.length ?? 0) > 0) && (
        <span className="answer-key-metadata" aria-label="Question Metadata">
          {item.difficulty && <DifficultyBadge difficulty={item.difficulty} />}
          {(item.topics ?? []).map((topic) => <TopicBadge topic={topic} key={topic} />)}
        </span>
      )}
      {item.suggestedAnswer && (
        <DocView className="answer-key-suggested" content={item.suggestedAnswer} />
      )}
      {item.parts && (
        <div className="answer-key-parts">
          {item.parts.map((part) => (
            <div className="answer-key-part" key={part.letter}>
              <span className="answer-key-part-letter">{part.letter}.</span>
              <span
                className="answer-key-answer"
                aria-label={part.answer ?? 'Blank answer'}
              >
                {part.answer}
              </span>
              {part.suggestedAnswer && (
                <DocView className="answer-key-suggested" content={part.suggestedAnswer} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// The furniture at the top of a sheet, drawn from the variant packing chose.
// The first page identifies the paper and names the test; every later page
// carries just enough to reunite a dropped stack and to stop a student swapping
// a page in from another arrangement. Neither repeats the section heading — that is
// content, and content is packed, not drawn here.
//
// Driven by the plan's own furniture rather than by a switch of its own: the
// identity fields, the repeated title and the arrangement label are planning
// decisions, so the DOCX adapter prints exactly the same ones. The header
// variant survives only as a class, because how tall each variant is remains a
// layout constant that CSS and packing must agree on.
export function PageHeaderContent({
  header,
  furniture,
  onTitleChange,
  titleDisabled = false,
}: {
  header: PageHeader
  furniture: PageFurniture
  /** Present only in the editor. The Exam's name is furniture on its own first
   *  page, so it can be typed there as well as in the document bar — one
   *  value, two places to reach it. Every other caller (measurement, print
   *  reference, export preview) renders plain text, which is what the DOCX
   *  adapter prints too. */
  onTitleChange?: (title: string) => void
  titleDisabled?: boolean
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
        <span className="page-id">{furniture.arrangementLabel}</span>
      </div>
      {furniture.title !== null && (
        <h1 className="exam-title">
          {onTitleChange ? (
            // The underline belongs to the name, not to the width of the
            // page: the mirrored value behind the input is what sizes it, so
            // the field is exactly as wide as what has been typed.
            <span className="exam-title-field" data-value={furniture.title || 'Untitled Exam'}>
              <input
                aria-label="Title printed on the exam"
                className="exam-title-input"
                size={1}
                value={furniture.title}
                disabled={titleDisabled}
                placeholder="Untitled Exam"
                onChange={(event) => onTitleChange(event.target.value)}
              />
            </span>
          ) : (
            furniture.title
          )}
        </h1>
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

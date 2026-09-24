// A Question, read in full.
//
// The one place a bank's Question is drawn whole rather than as a row: its
// type and classification, the stem, the answers with the correct one
// marked, a matching set's items and Word Bank, and a Short Answer's suggested
// answer. The import dialog reads a file's banks this way before anything is
// imported, and the Question Bank page reads its own bank this way, so a bank
// looks the same on the way in as it does once it is here.
//
// It draws what it is handed and nothing else. Each caller turns its own
// Question shape — a record Question from a file, or an editor Question —
// into a `QuestionReadingContent`; the document fragments are already editor
// nodes by the time they arrive.

import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { DifficultyBadge, TopicBadge } from './badges'
import { DocView } from './doc-view'
import type { QuestionReadingContent } from './question-reading-content'

/** A bank has no order, so its Questions carry no number. */
export function QuestionReading({
  content,
  aside,
}: {
  content: QuestionReadingContent
  /** Anything the surface adds to the head row — an "In exam" mark, an action. */
  aside?: ReactNode
}) {
  return <>
    <div className="question-reading-head">
      <span className="question-reading-type">{content.typeLabel}</span>
      {content.difficulty && <DifficultyBadge difficulty={content.difficulty} />}
      {content.topics.map((topic) => <TopicBadge key={topic} topic={topic} />)}
      {aside}
    </div>
    <DocView className="question-reading-stem" content={content.stem} />
    {content.choices && (
      <ol type="A" className="question-reading-choices">
        {content.choices.map((choice) => (
          <li key={choice.id} className={choice.correct ? 'is-correct' : undefined}>
            <DocView content={choice.content} />
            {choice.correct && (
              <Check className="question-reading-correct" role="img" aria-label="Correct answer" />
            )}
          </li>
        ))}
      </ol>
    )}
    {content.matching && (
      <div className="record-matching question-reading-matching">
        <ol className="record-matching-items">
          {content.matching.prompts.map((prompt) => (
            <li key={prompt.id}>
              <span
                className="record-matching-blank"
                aria-label={prompt.letter ? 'Matched answer' : 'Unmatched'}
              >
                {prompt.letter ?? '—'}
              </span>
              <DocView content={prompt.content} />
            </li>
          ))}
        </ol>
        <ol type="A" className="question-reading-choices">
          {content.matching.wordBank.map((answer) => (
            <li key={answer.id}>
              <DocView content={answer.content} />
            </li>
          ))}
        </ol>
      </div>
    )}
    {content.suggestedAnswer && (
      <section className="question-reading-answer">
        <h4>Suggested Answer</h4>
        <DocView content={content.suggestedAnswer} />
      </section>
    )}
  </>
}

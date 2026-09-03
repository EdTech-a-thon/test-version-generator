// The coloured marks a question's classification wears: its Difficulty and its
// Topics. One module, because the popup that sets them and the Question Bank
// row that shows them must agree — a Topic that is one colour in the front
// matter and another in the bank would read as two Topics.

import { SignalHigh, SignalLow, SignalMedium } from 'lucide-react'
import { DIFFICULTY_LABELS, type Difficulty } from './exam'
import type { ReactNode } from 'react'

/** Difficulty is ordered, so it is drawn as a rising signal rather than three
 *  unrelated pictures: the mark says which of the three it is even where the
 *  colour cannot. */
const DIFFICULTY_ICONS: Record<Difficulty, ReactNode> = {
  easy: <SignalLow />,
  medium: <SignalMedium />,
  hard: <SignalHigh />,
}

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span className="badge badge-difficulty" data-difficulty={difficulty}>
      {DIFFICULTY_ICONS[difficulty]}
      {DIFFICULTY_LABELS[difficulty]}
    </span>
  )
}

/** How many tints `.badge-topic` is styled for in styles.css. */
const TOPIC_TINTS = 6

/**
 * The tint a Topic wears, derived from its name rather than stored beside it.
 *
 * That makes one Topic one colour in every row it appears in and in every
 * session, without a colour becoming a second thing about a Topic that has to
 * be kept in step with its name. Which colour a Topic lands on is arbitrary —
 * the point is only that two Topics beside each other usually differ.
 */
function topicTint(topic: string): number {
  let hash = 0
  for (let index = 0; index < topic.length; index += 1) {
    hash = (hash * 31 + topic.charCodeAt(index)) >>> 0
  }
  return hash % TOPIC_TINTS
}

export function TopicBadge({ topic }: { topic: string }) {
  return (
    <span className="badge badge-topic" data-tint={topicTint(topic)}>
      {topic}
    </span>
  )
}

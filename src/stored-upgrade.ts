// Reading what an earlier build of the editor stored.
//
// Questions and drafts live in the teacher's browser, written by whichever
// build of the editor they last used. A build that renamed something must
// still read what its predecessor wrote, or the first edit after an update
// writes a blank draft over the teacher's work. This is where each such rename
// is undone on the way in, so everything downstream reads only current shapes.

import type { Question } from './exam'
import type { ProseMirrorJSON } from './question-doc'

// The Multipart Question Type was first built as "Stimulus", and a question
// written then carries that type and those node names.
const RENAMED_NODES: Readonly<Record<string, string>> = {
  stimulusParts: 'multipartParts',
  stimulusPart: 'multipartPart',
  stimulusPartStem: 'multipartPartStem',
}

function renamedNodes(node: ProseMirrorJSON): ProseMirrorJSON {
  const renamed = typeof node.type === 'string' ? RENAMED_NODES[node.type] : undefined
  const content = Array.isArray(node.content)
    ? (node.content as ProseMirrorJSON[]).map(renamedNodes)
    : undefined
  return {
    ...node,
    ...(renamed ? { type: renamed } : {}),
    ...(content ? { content } : {}),
  }
}

/** A stored question in its current shape. A question that is already current
 *  is returned as it is. */
export function upgradeStoredQuestion(question: Question): Question {
  if ((question.type as string) !== 'stimulus') return question
  return { ...question, type: 'multipart', doc: renamedNodes(question.doc) }
}

import { bankLetter } from './matching'
import type {
  PendingImageReference,
  QuestionBankRecordQuestion,
  SemanticDocument,
  SemanticNode,
} from './question-bank-export'
import type { ParsedQuestionBankRecord } from './question-bank-import'
import type { ImportProposal } from './package-import'
import { pendingImageOf, type ProseMirrorJSON } from './question-doc'

/**
 * Pending Images in a proposal, read and resolved without touching storage.
 *
 * A Pending Image is found by where it sits: its bank, its Question, the part
 * of the Question (the stem, a choice, a matching item or Word Bank answer,
 * the Suggested Answer) and its place among that part's Pending Images. That
 * location is its key, so the teacher's choices in Resolve Images are plain
 * data — key to Media Asset — handed to the import plan with the rest of the
 * selection, and written in the same commit.
 */

export type MediaAssetDeclaration = ParsedQuestionBankRecord['media'][number]

export type PendingImageOccurrence = {
  key: string
  bankId: string
  /** 1-based position of the Question in its bank. */
  questionNumber: number
  /** Where in the Question it sits, as a teacher reads it: “Question”,
   *  “Answer B”, “Item 2”, “Word Bank C”, “Suggested Answer”. */
  where: string
  pending: PendingImageReference
  alt?: string
  caption?: string
  /** How to name it where the Question number says nothing, such as inside
   *  the Question's own editor. */
  label?: string
}

/** Key → the Media Asset that fills it. Absent keys stay Pending Images. */
export type PendingImageResolution = ReadonlyMap<string, MediaAssetDeclaration>

type Part = { id: string; where: string; document: SemanticDocument }

function partsOf(question: QuestionBankRecordQuestion): Part[] {
  return [
    { id: 'stem', where: 'Question', document: question.stem },
    ...(question.choices ?? []).map((choice, index) => ({
      id: choice.id,
      where: `Answer ${bankLetter(index)}`,
      document: choice.content,
    })),
    ...(question.prompts ?? []).map((prompt, index) => ({
      id: prompt.id,
      where: `Item ${index + 1}`,
      document: prompt.content,
    })),
    ...(question.wordBank ?? []).map((answer, index) => ({
      id: answer.id,
      where: `Word Bank ${bankLetter(index)}`,
      document: answer.content,
    })),
    ...(question.suggestedAnswer
      ? [{ id: 'suggested-answer', where: 'Suggested Answer', document: question.suggestedAnswer }]
      : []),
  ]
}

function pendingNodes(document: SemanticDocument): SemanticNode[] {
  const found: SemanticNode[] = []
  const visit = (node: SemanticNode) => {
    if ((node.type === 'inline-image' || node.type === 'block-image') && node.pending) found.push(node)
    for (const child of node.content ?? []) visit(child)
  }
  for (const node of document.content) visit(node)
  return found
}

const keyOf = (bankId: string, questionId: string, partId: string, index: number) =>
  `${bankId}/${questionId}/${partId}/${index}`

/** Every Pending Image in a bank's record, in the order its Questions and
 *  their parts are read — the order an assistant wrote them, so a caption
 *  gets the picture that follows it. */
export function pendingImagesOfRecord(
  bankId: string,
  record: Pick<ParsedQuestionBankRecord, 'bank'>,
): PendingImageOccurrence[] {
  return record.bank.questions.flatMap((question, questionIndex) =>
    partsOf(question).flatMap((part) =>
      pendingNodes(part.document).map((node, index) => ({
        key: keyOf(bankId, question.id, part.id, index),
        bankId,
        questionNumber: questionIndex + 1,
        where: part.where,
        pending: { ...node.pending! },
        ...(node.alt !== undefined ? { alt: node.alt } : {}),
        ...(node.caption !== undefined ? { caption: node.caption } : {}),
      })),
    ),
  )
}

/** Every Pending Image in the banks a selection brings in. */
export function pendingImagesOf(
  proposal: Pick<ImportProposal, 'banks'>,
  allowed: (bankId: string) => boolean = () => true,
): PendingImageOccurrence[] {
  return proposal.banks
    .filter((bank) => allowed(bank.id))
    .flatMap((bank) => pendingImagesOfRecord(bank.id, bank.record))
}

/** A bank's record with every resolved Pending Image made an ordinary image
 *  of its Media Asset, declared once however many places use it. Unresolved
 *  ones are left exactly as they were. */
export function withResolvedImages(
  bankId: string,
  record: ParsedQuestionBankRecord,
  resolution: PendingImageResolution,
): ParsedQuestionBankRecord {
  const declared = new Map(record.media.map((asset) => [asset.id, asset]))
  const resolveDocument = (questionId: string, partId: string, document: SemanticDocument): SemanticDocument => {
    let index = 0
    const visit = (node: SemanticNode): SemanticNode => {
      if ((node.type === 'inline-image' || node.type === 'block-image') && node.pending) {
        const asset = resolution.get(keyOf(bankId, questionId, partId, index))
        index += 1
        if (!asset) return node
        declared.set(asset.id, asset)
        const { pending: _pending, ...rest } = node
        void _pending
        return { ...rest, asset: asset.id }
      }
      return node.content ? { ...node, content: node.content.map(visit) } : node
    }
    return { ...document, content: document.content.map(visit) }
  }
  const questions = record.bank.questions.map((question) => ({
    ...question,
    stem: resolveDocument(question.id, 'stem', question.stem),
    ...(question.choices
      ? { choices: question.choices.map((choice) => ({ ...choice, content: resolveDocument(question.id, choice.id, choice.content) })) }
      : {}),
    ...(question.prompts
      ? { prompts: question.prompts.map((prompt) => ({ ...prompt, content: resolveDocument(question.id, prompt.id, prompt.content) })) }
      : {}),
    ...(question.wordBank
      ? { wordBank: question.wordBank.map((answer) => ({ ...answer, content: resolveDocument(question.id, answer.id, answer.content) })) }
      : {}),
    ...(question.suggestedAnswer
      ? { suggestedAnswer: resolveDocument(question.id, 'suggested-answer', question.suggestedAnswer) }
      : {}),
  }))
  return { ...record, bank: { ...record.bank, questions }, media: [...declared.values()] }
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function base64(bytes: Uint8Array): string {
  let value = ''
  for (let at = 0; at < bytes.length; at += 0x8000) {
    value += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return btoa(value)
}

/** The Media Asset declaration for a picture's bytes, addressed by content —
 *  so one tag used in several places is one asset. */
export async function mediaAssetOf(
  bytes: Uint8Array,
  mimeType: MediaAssetDeclaration['mimeType'],
): Promise<MediaAssetDeclaration> {
  // Loaded on demand: the record parsers are not wanted until a picture is.
  const { mediaDimensions } = await import('./question-bank-import')
  const dimensions = mediaDimensions(mimeType, bytes)
  if (!dimensions) throw new Error(`This picture is not a valid ${mimeType} image.`)
  const digest = hex(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))
  return { id: `sha256:${digest}`, mimeType, ...dimensions, bytes: base64(bytes) }
}

/** What the text check needs of a Source Document. */
export type SourceDocumentFacts = { tags: readonly { tag: number }[]; pageText: readonly string[] }

export type SourceDocumentCheck = {
  /** Tags the record names that the document does not have. */
  unknownTags: number[]
  /** Stems long enough to look for, and how many were found. Both zero when
   *  the document has no text layer. */
  stemsChecked: number
  stemsFound: number
  /** Whether the record seems to come from this document. */
  matches: boolean
}

const normalized = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** A stem's longest unbroken run of text: math, images and breaks split it,
 *  since the document's text layer need not spell those the same way. */
function longestRun(document: SemanticDocument): string {
  const runs: string[] = ['']
  const visit = (node: SemanticNode) => {
    if (node.type === 'text') runs[runs.length - 1] += node.text ?? ''
    else if (node.content) {
      if (node.type !== 'paragraph') runs.push('')
      for (const child of node.content) visit(child)
      runs.push('')
    } else runs.push('')
  }
  for (const node of document.content) visit(node)
  return runs.map(normalized).sort((a, b) => b.length - a.length)[0] ?? ''
}

const MIN_WORDS = 3

/**
 * Whether a record seems to come from a Source Document: every tag it names
 * exists, and — when the document has a text layer — most of its stems appear
 * in the document's text. It is a check, not a proof: a teacher warned by it
 * may still import.
 */
export function checkAgainstSourceDocument(
  proposal: Pick<ImportProposal, 'banks'>,
  source: SourceDocumentFacts,
): SourceDocumentCheck {
  const tags = new Set(source.tags.map(({ tag }) => tag))
  const unknownTags = [
    ...new Set(
      pendingImagesOf(proposal).flatMap(({ pending }) =>
        'image' in pending && !tags.has(pending.image) ? [pending.image] : [],
      ),
    ),
  ].sort((a, b) => a - b)
  const text = normalized(source.pageText.join(' '))
  let stemsChecked = 0
  let stemsFound = 0
  if (text) {
    for (const bank of proposal.banks) {
      for (const question of bank.record.bank.questions) {
        const run = longestRun(question.stem)
        if (run.split(' ').length < MIN_WORDS) continue
        stemsChecked += 1
        if (text.includes(run)) stemsFound += 1
      }
    }
  }
  return {
    unknownTags,
    stemsChecked,
    stemsFound,
    matches: unknownTags.length === 0 && (stemsChecked === 0 || stemsFound * 2 > stemsChecked),
  }
}

type EditorQuestion = { id: string; doc: ProseMirrorJSON; suggestedAnswer?: ProseMirrorJSON }

const editorChildren = (node: ProseMirrorJSON): ProseMirrorJSON[] =>
  Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []

/** Every Pending Image of stored Questions, numbered as the bank lists them.
 *  Keyed by Question and place in its document, the way Resolve Images keys
 *  them in an import. */
export function pendingImagesOfQuestions(questions: readonly EditorQuestion[]): PendingImageOccurrence[] {
  return questions.flatMap((question, index) => {
    const found: PendingImageOccurrence[] = []
    const counts = { doc: 0, suggestedAnswer: 0 }
    const visit = (part: 'doc' | 'suggestedAnswer', node: ProseMirrorJSON, where: string) => {
      const pending = pendingImageOf(node)
      if (pending) {
        const attrs = node.attrs as Record<string, unknown>
        found.push({
          key: `${question.id}/${part}/${counts[part]++}`,
          bankId: '',
          questionNumber: index + 1,
          where,
          pending,
          ...(typeof attrs.alt === 'string' && attrs.alt ? { alt: attrs.alt } : {}),
          ...(typeof attrs.caption === 'string' && attrs.caption ? { caption: attrs.caption } : {}),
        })
      }
      const answers = editorChildren(node).filter((child) => child.type === 'multipleChoiceChoice')
      for (const child of editorChildren(node)) {
        const letter = answers.indexOf(child)
        visit(part, child, letter >= 0 ? `Answer ${bankLetter(letter)}` : where)
      }
    }
    visit('doc', question.doc, 'Question')
    if (question.suggestedAnswer) visit('suggestedAnswer', question.suggestedAnswer, 'Suggested Answer')
    return found
  })
}

/** A stored Question with each resolved Pending Image given its stored
 *  picture's source, found by the same keys `pendingImagesOfQuestions` gave. */
export function withStoredPictures<Q extends EditorQuestion>(question: Q, sources: ReadonlyMap<string, string>): Q {
  const resolve = (part: 'doc' | 'suggestedAnswer', document: ProseMirrorJSON): ProseMirrorJSON => {
    let index = 0
    const visit = (node: ProseMirrorJSON): ProseMirrorJSON => {
      if (pendingImageOf(node)) {
        const src = sources.get(`${question.id}/${part}/${index}`)
        index += 1
        if (!src) return node
        const { pending: _pending, ...attrs } = node.attrs as Record<string, unknown>
        void _pending
        return { ...node, attrs: { ...attrs, src } }
      }
      return Array.isArray(node.content) ? { ...node, content: editorChildren(node).map(visit) } : node
    }
    return visit(document)
  }
  return {
    ...question,
    doc: resolve('doc', question.doc),
    ...(question.suggestedAnswer ? { suggestedAnswer: resolve('suggestedAnswer', question.suggestedAnswer) } : {}),
  }
}

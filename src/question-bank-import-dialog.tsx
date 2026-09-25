import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight, Copy, FileText, ImageIcon, Library, UploadCloud, type LucideIcon } from 'lucide-react'
import extractInstructions from '../public/extract.md?raw'
import { fillImageTags } from './image-tag-list'
import {
  RECORD_PART_TYPE_LABELS,
  RECORD_TYPE_LABELS,
  RECORD_TYPE_ORDER,
  recordDocumentToEditorNodes,
  wordBankLettersOf,
  type QuestionBankRecordQuestion,
  type SemanticDocument,
} from './question-bank-export'
import { TopicBadge } from './badges'
import type { Question } from './exam'
import { QuestionReading } from './question-reading'
import type { QuestionReadingContent } from './question-reading-content'
import { pendingImageOf, type ProseMirrorJSON } from './question-doc'
import type { ImportProposal, ProposedBank, ProposedExam } from './package-import'
import {
  deniedBanksOf,
  hasAllowedItems,
  importSentence,
  importCounts,
  initialSelection,
  setBankAllowed,
  setBankTarget,
  setExamAllowed,
  type ImportSelection,
} from './import-selection'
import { selectedExam } from './selected-exam'
import { planExport, type LayoutPlan } from './export-plan'
import { domMeasure } from './dom-measure'
import { ExportPreview } from './exam-page'
import { inspectUploadedFile, isRecordFile, needsConversion as fileNeedsConversion } from './question-bank-upload'
import {
  checkAgainstSourceDocument,
  pendingImagesOf,
  pendingKeyOf,
  withPendingKeys,
  type PendingImageOccurrence,
  type PendingImageResolution,
  type SourceDocumentCheck,
} from './pending-images'
import { PageCropper, PictureChoices } from './resolve-images'
import { namedPage, usePictureChoice } from './picture-choice'
import {
  cropChoice,
  estimatedSize,
  originName,
  pictureSource,
  placeName,
  prefilledPictures,
  resolutionOf,
  type ResolvedPicture,
  type Resolutions,
  type ResolvingSource,
} from './resolved-pictures'
import { PictureSlotContext, type PictureSlot } from './picture-slot'
import { discardWaitingImport, readWaitingImport, type ImportFileKind, type WaitingImport } from './import-history'
import { bestWaitingImport } from './import-file-route'
import { SourceDocumentSteps } from './source-document-steps'
import { TEST_FILE_TYPES, kindOfFile, readSourceDocument, startWaitingImport } from './source-file'
import { useModalScrollLock } from './use-modal-scroll-lock'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const plural = (count: number, singular: string) =>
  `${count} ${count === 1 ? singular : `${singular}s`}`

/**
 * The two kinds of thing a file can bring in, each with one icon and one
 * colour used wherever the dialog names it — its Import List section, the
 * rail's heading, a link to it — so an entry is recognisably a bank or a Test
 * before it is read. An Exam is called a Test here: it is the word for the
 * file in a teacher's hand. The icons are the ones the sidebar gives each
 * section.
 */
const KINDS = {
  bank: { Icon: Library, noun: 'Question Bank' },
  exam: { Icon: FileText, noun: 'Test' },
} satisfies Record<string, { Icon: LucideIcon; noun: string }>
type Kind = keyof typeof KINDS

/** Which item the rail is describing, and — since its checkbox lives in the
 *  Import List — whether it is coming. */
function RailHead({ kind, name, allowed }: { kind: Kind; name: string; allowed: boolean }) {
  const { Icon, noun } = KINDS[kind]
  return <header className="bank-import-rail-head" data-kind={kind}>
    <p><Icon aria-hidden="true" />{noun}</p>
    <h3>{name}</h3>
    {!allowed && <p className="bank-import-left-out">Not being imported</p>}
  </header>
}

/** A picture the preview draws in a Pending Image's place. */
type PreviewPicture = { src: string; ratio?: number }

/**
 * Point a preview document's images at the bytes the file carries, and each
 * Pending Image at the picture chosen for it.
 *
 * `recordDocumentToEditorNodes` addresses an image as `/local-images/<hash>`,
 * which resolves only for media that already lives here. Nothing has been
 * imported yet, so the preview would draw every image broken; the file's own
 * Media Assets are the only copy that exists, and they are already base64.
 * A Pending Image carries its key (`withPendingKeys`), which the preview keeps
 * as `pictureKey` so that clicking it opens that picture's choices.
 */
function resolveMedia(
  node: ProseMirrorJSON,
  sources: ReadonlyMap<string, string>,
  pictures: ReadonlyMap<string, PreviewPicture>,
): ProseMirrorJSON {
  const attrs = node.attrs as Record<string, unknown> | null | undefined
  const key = pendingKeyOf(node)
  if (key) {
    const picture = pictures.get(key)
    const { pending: _pending, ...rest } = attrs ?? {}
    void _pending
    return {
      ...node,
      attrs: picture
        ? { ...rest, src: picture.src, ...(picture.ratio !== undefined ? { ratio: picture.ratio } : {}), pictureKey: key }
        : { ...rest, pending: pendingImageOf(node), pictureKey: key },
    }
  }
  const resolved =
    attrs && typeof attrs.src === 'string' ? sources.get(attrs.src) : undefined
  return {
    ...node,
    ...(resolved ? { attrs: { ...attrs, src: resolved } } : {}),
    ...(Array.isArray(node.content)
      ? {
          content: (node.content as ProseMirrorJSON[]).map((child) =>
            resolveMedia(child, sources, pictures),
          ),
        }
      : {}),
  }
}

function mediaSources(proposal: ImportProposal): Map<string, string> {
  const sources = new Map<string, string>()
  for (const bank of proposal.banks) {
    for (const asset of bank.record.media) {
      sources.set(
        `/local-images/${asset.id.slice('sha256:'.length)}`,
        `data:${asset.mimeType};base64,${asset.bytes}`,
      )
    }
  }
  return sources
}

/**
 * The student test an Exam would print, laid out by the same Layout Plan the
 * export uses. It is built the way the import will build the Exam — through
 * the same plan — so what is previewed is what arrives.
 */
async function examPreviewPlan(
  proposal: ImportProposal,
  examKey: string,
  sources: ReadonlyMap<string, string>,
  pictures: ReadonlyMap<string, PreviewPicture>,
): Promise<LayoutPlan | null> {
  // Loaded on demand, like the importer: it brings the record parsers.
  const { planImport } = await import('./package-commit')
  let next = 0
  const plan = planImport(proposal, initialSelection(proposal), () => `preview-${next++}`)
  const planned = plan.exams.find(({ source }) => source === examKey)
  if (!planned || planned.saved.workingCopy.questionIds.length === 0) return null
  const resolve = (question: Question): Question => ({
    ...question,
    doc: resolveMedia(question.doc, sources, pictures),
  })
  const { exam, arrangement } = selectedExam(
    { questions: planned.saved.questionBank.questions.map(resolve) },
    planned.saved.workingCopy,
  )
  return planExport({
    exam,
    arrangement,
    selection: { test: true, answerKey: false },
    measure: domMeasure,
  })
}

/** A record Question, as the reading draws it. */
function readingOfRecordQuestion(
  question: QuestionBankRecordQuestion,
  previewDocument: (document: SemanticDocument) => ProseMirrorJSON[],
): QuestionReadingContent {
  const letters = wordBankLettersOf(question)
  return {
    typeLabel: RECORD_TYPE_LABELS[question.type],
    difficulty: question.difficulty,
    topics: question.topics ?? [],
    stem: previewDocument(question.stem),
    ...(question.choices ? {
      choices: question.choices.map((choice) => ({
        id: choice.id,
        content: previewDocument(choice.content),
        correct: choice.correct,
      })),
    } : {}),
    ...(question.prompts && question.wordBank ? {
      matching: {
        prompts: question.prompts.map((prompt) => ({
          id: prompt.id,
          content: previewDocument(prompt.content),
          letter: letters.get(prompt.answer ?? ''),
        })),
        wordBank: question.wordBank.map((answer) => ({
          id: answer.id,
          content: previewDocument(answer.content),
        })),
      },
    } : {}),
    ...(question.suggestedAnswer ? { suggestedAnswer: previewDocument(question.suggestedAnswer) } : {}),
    ...(question.parts ? {
      parts: question.parts.map((part, index) => ({
        id: part.id,
        letter: String.fromCharCode(97 + index),
        typeLabel: RECORD_PART_TYPE_LABELS[part.type],
        stem: previewDocument(part.stem),
        ...(part.choices ? {
          choices: part.choices.map((choice) => ({
            id: choice.id,
            content: previewDocument(choice.content),
            correct: choice.correct,
          })),
        } : {}),
        ...(part.suggestedAnswer ? { suggestedAnswer: previewDocument(part.suggestedAnswer) } : {}),
      })),
    } : {}),
  }
}

/** A bank read as a list of its questions. It has no printable page, so it
 *  is shown borderless rather than on a sheet that would suggest one. */
function BankPreview({
  bank,
  previewDocument,
}: {
  bank: ProposedBank
  previewDocument: (document: SemanticDocument) => ProseMirrorJSON[]
}) {
  const { record } = bank
  const questions = record.bank.questions
  return <div className="bank-import-reading">
    <header className="bank-import-preview-head">
      <h3>{record.bank.name || 'Untitled Question Bank'}</h3>
      <p>{plural(questions.length, 'Question')}</p>
      {record.bank.description && (
        <p className="bank-import-preview-description">{record.bank.description}</p>
      )}
    </header>
    {questions.map((question) => (
      <article key={question.id} className="question-reading">
        <QuestionReading content={readingOfRecordQuestion(question, previewDocument)} />
      </article>
    ))}
  </div>
}

function ExamPreview({
  proposal,
  exam,
  sources,
  pictures,
}: {
  proposal: ImportProposal
  exam: ProposedExam
  sources: ReadonlyMap<string, string>
  pictures: ReadonlyMap<string, PreviewPicture>
}) {
  const [plan, setPlan] = useState<LayoutPlan | null | 'loading'>('loading')
  // Another Test starts from nothing; a changed picture keeps the pages on
  // screen, where the teacher is looking, until they are laid out again.
  useEffect(() => setPlan('loading'), [exam.key])
  useEffect(() => {
    let current = true
    examPreviewPlan(proposal, exam.key, sources, pictures)
      .catch(() => null)
      .then((next) => { if (current) setPlan(next) })
    return () => { current = false }
  }, [proposal, exam.key, sources, pictures])
  return plan === 'loading'
    ? <p className="bank-import-empty" role="status">Laying out pages…</p>
    : plan
    ? <div className="bank-import-exam-pages" aria-label={`${exam.name || 'Untitled Test'} pages`}>
        <ExportPreview plan={plan} />
      </div>
    : <p className="bank-import-empty">This Test has no Questions yet.</p>
}

/** How many of a Test's positions are of each Question Type, read from the
 *  bank Question each position references — the same rows a bank's summary
 *  counts, so a Test and the banks it draws on read alike. */
function examTypeCounts(
  proposal: ImportProposal,
  exam: ProposedExam,
): Record<(typeof RECORD_TYPE_ORDER)[number], number> {
  const counts = Object.fromEntries(RECORD_TYPE_ORDER.map((type) => [type, 0])) as Record<
    (typeof RECORD_TYPE_ORDER)[number],
    number
  >
  for (const { question } of exam.positions) {
    const type = proposal.banks
      .find(({ id }) => id === question.bank)
      ?.record.bank.questions.find(({ id }) => id === question.question)?.type
    if (type) counts[type] += 1
  }
  return counts
}

/** One bank's facts, in the rows the Question Bank import has always shown. */
function BankSummary({ bank, picturesNeeded }: { bank: ProposedBank; picturesNeeded: number }) {
  const { record, summary } = bank
  return <>
    <dl className="bank-import-summary">
      {RECORD_TYPE_ORDER.map((type) => (
        <div key={type}>
          <dt>{RECORD_TYPE_LABELS[type]}</dt>
          <dd>{summary.questionCounts[type]}</dd>
        </div>
      ))}
      {summary.questionsWithoutCorrectAnswer > 0 && (
        <div className="is-warning">
          <dt>No correct answer marked</dt>
          <dd>{summary.questionsWithoutCorrectAnswer}</dd>
        </div>
      )}
      {summary.pendingImages > picturesNeeded && (
        <div>
          <dt>Pictures filled in</dt>
          <dd>{summary.pendingImages - picturesNeeded}</dd>
        </div>
      )}
      {picturesNeeded > 0 && (
        <div className="is-warning">
          <dt>Pictures needed</dt>
          <dd>{picturesNeeded}</dd>
        </div>
      )}
      <div>
        <dt>Media Assets</dt>
        <dd>
          {summary.mediaAssets}
          {summary.mediaAssets > 0 && <small>{formatBytes(summary.decodedMediaBytes)}</small>}
        </dd>
      </div>
      <div>
        <dt>External links</dt>
        <dd>{summary.externalLinks ? 'Present' : 'None'}</dd>
      </div>
      <div>
        <dt>Format version</dt>
        <dd>{summary.formatVersion}</dd>
      </div>
    </dl>
    {summary.topics.length > 0 && (
      <div className="bank-import-topics">
        <h4>Topics</h4>
        <div>{summary.topics.map((topic) => <TopicBadge key={topic} topic={topic} />)}</div>
      </div>
    )}
    {(record.bank.author || record.bank.license) && (
      <dl className="bank-import-provenance">
        {record.bank.author && (
          <div>
            <dt>Declared author (unverified)</dt>
            <dd>{record.bank.author}</dd>
          </div>
        )}
        {record.bank.license && (
          <div>
            <dt>License</dt>
            <dd>
              {record.bank.license.name}
              {record.bank.license.url ? ` — ${record.bank.license.url}` : ''}
            </dd>
          </div>
        )}
      </dl>
    )}
  </>
}

type Focus = { kind: 'bank'; id: string } | { kind: 'exam'; key: string }

/** A way to another item from inside the rail: a Test’s banks, a bank’s Tests. */
function TabLink({
  kind,
  name,
  detail,
  onShow,
}: {
  kind: Kind
  name: string
  detail?: string
  onShow: () => void
}) {
  const { Icon } = KINDS[kind]
  return <button type="button" className="bank-import-link" data-kind={kind} onClick={onShow}>
    <Icon aria-hidden="true" />
    <span>{name}</span>
    {detail && <small>{detail}</small>}
  </button>
}

/**
 * A Pending Image in the preview, drawn with the picture chosen for it — or
 * as “picture needed” — and a badge saying which. Clicking it opens its
 * choices in the rail. The badge sits over the picture, taking up no room, so
 * the page lays out as it will print.
 */
function PreviewPictureButton({
  occurrence,
  resolved,
  source,
  inline,
  selected,
  onPick,
  children,
}: {
  occurrence: PendingImageOccurrence
  resolved: ResolvedPicture | undefined
  source: ResolvingSource | null
  inline: boolean
  selected: boolean
  onPick: () => void
  children: ReactNode
}) {
  const badge = !resolved
    ? 'Add a picture'
    : resolved.origin.kind === 'tag'
      ? `Detected image · IMG ${resolved.origin.tag}`
      : resolved.origin.kind === 'crop'
        ? `Cropped from page ${resolved.origin.page}`
        : 'Uploaded'
  return <span
    className="preview-picture"
    data-inline={inline ? 'true' : undefined}
    data-state={resolved ? 'filled' : 'needed'}
    data-selected={selected ? 'true' : undefined}
    role="button"
    tabIndex={0}
    aria-pressed={selected}
    aria-label={`${placeName(occurrence)}: ${resolved ? originName(resolved, source) : 'picture needed'}. Change picture`}
    onClick={(event) => {
      event.stopPropagation()
      onPick()
    }}
    onKeyDown={(event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onPick()
    }}
  >
    {children}
    <span className="preview-picture-badge" aria-hidden="true">{badge}</span>
  </span>
}

const focusKey = (focus: Focus) => (focus.kind === 'bank' ? `bank:${focus.id}` : `exam:${focus.key}`)

export function QuestionBankImportDialog({
  onClose,
  onImport,
  initialFile,
  targetBankId,
  loadBanks,
  waitingImportId,
}: {
  onClose: () => void
  onImport: (
    proposal: ImportProposal,
    selection: ImportSelection,
    options: {
      resolution: PendingImageResolution
      history: { fileName: string; kind: ImportFileKind; waitingImportId?: string }
    },
  ) => Promise<void>
  /** A file already chosen elsewhere — dropped onto the page — inspected as
   *  soon as the dialog opens rather than asked for again. */
  initialFile?: File
  /** The bank the import was started from, which every bank in the file
   *  defaults to adding into. */
  targetBankId?: string
  /** The banks on this device, for “Add to an existing one”. */
  loadBanks: () => Promise<readonly { id: string; name: string }[]>
  /** The waiting import the file is the assistant's answer to, when the
   *  dialog was opened from that import's own page. */
  waitingImportId?: string
}) {
  const titleId = useId()
  const listId = useId()
  const dialog = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [proposal, setProposal] = useState<ImportProposal | null>(null)
  const [selection, setSelection] = useState<ImportSelection | null>(null)
  /** Each bank's name for “Create new question bank”, kept while the target
   *  is switched to an existing bank and back. */
  const [names, setNames] = useState<Record<string, string>>({})
  const [focus, setFocus] = useState<Focus | null>(null)
  const [existingBanks, setExistingBanks] = useState<readonly { id: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  // A file this app cannot read at all — a scan, a screenshot, a PDF that
  // did not come from here — is not a broken import, it is a test that has
  // not been converted yet. That failure is answered with the way to convert
  // it rather than with a reading of what went wrong.
  const [needsConversion, setNeedsConversion] = useState(false)
  const [phase, setPhase] = useState<'choose' | 'inspecting' | 'analyzing' | 'saving'>('choose')
  /** The import this dialog is converting: one it started, or the one it
   *  was opened for. Every dialog is a new import otherwise — it never picks
   *  up another import that is part-way through. */
  const [waiting, setWaiting] = useState<WaitingImport | null>(null)
  /** Set when the file under review was paired with a waiting import: how
   *  well it matches the Source Document. */
  const [paired, setPaired] = useState<SourceDocumentCheck | null>(null)
  /** The file under review, as the import history will name it. */
  const [inspected, setInspected] = useState<{ fileName: string; kind: ImportFileKind } | null>(null)
  const [filling, setFilling] = useState(false)
  /** The Pending Image whose choices the rail shows, picked in the preview,
   *  and whether its page is being cropped in the preview's place. */
  const [picked, setPicked] = useState<string | null>(null)
  const [cropping, setCropping] = useState(false)
  const [resolutions, setResolutions] = useState<Resolutions>(new Map())
  /** A Source Document dropped into Resolve Images for a file that was not
   *  paired with a waiting import. Used for this import only, never kept. */
  const [suppliedSource, setSuppliedSource] = useState<ResolvingSource | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])
  const busy = phase !== 'choose'
  const busyRef = useRef(busy)
  busyRef.current = busy
  const backOutRef = useRef<() => boolean>(() => false)
  backOutRef.current = () => {
    if (cropping) setCropping(false)
    else if (picked) setPicked(null)
    else return false
    return true
  }
  useModalScrollLock()

  useEffect(() => {
    let current = true
    void loadBanks().then((banks) => { if (current) setExistingBanks(banks) }, () => undefined)
    return () => { current = false }
  }, [loadBanks])


  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => input.current?.focus())
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        // A picture's choices close before the dialog does.
        if (backOutRef.current()) return
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled)',
        ) ?? [],
      )
      if (!controls.length) return
      const first = controls[0]!
      const last = controls.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus()
      })
    }
  }, [onClose])

  useEffect(() => {
    if (error && phase === 'choose') input.current?.focus()
  }, [error, phase])

  // The file control has gone with the choose step, taking focus with it. It
  // goes to the shown item's entry in the Import List, not to the bank's name
  // at the foot of the rail, which would scroll the rail past its facts.
  useEffect(() => {
    if (!proposal) return
    requestAnimationFrame(() => {
      if (dialog.current?.contains(document.activeElement)) return
      dialog.current
        ?.querySelector<HTMLElement>('.bank-import-entry[aria-pressed="true"]')
        ?.focus()
    })
  }, [proposal])

  const failed = (reason: unknown) => {
    setNeedsConversion(fileNeedsConversion(reason))
    setError(
      reason instanceof Error && reason.message
        ? reason.message
        : 'This file could not be inspected safely.',
    )
  }

  /** A PDF that is not a Test Parrot file is a Source Document: its pictures
   *  are found and tagged, and the import waits for the assistant. */
  const startSourceDocument = async (file: File) => {
    setPhase('analyzing')
    setError(null)
    setNeedsConversion(false)
    try {
      setWaiting(await startWaitingImport(file))
    } catch (reason) {
      failed(reason)
    } finally {
      setPhase('choose')
    }
  }

  /** A test to convert rather than a file to import — a photo, a Word
   *  document, or a PDF with no Test Parrot file inside — starts a new
   *  import. Any other import already waiting keeps waiting. */
  const startConverting = startSourceDocument

  /**
   * The waiting import a returned file answers, and how well it matches. The
   * one this dialog is converting is paired whatever the check says, since
   * the teacher dropped the file on it; otherwise the file is paired only
   * with a waiting import it clearly came from, the best match if several.
   */
  const pairingFor = async (next: ImportProposal) => {
    const own = waiting ?? (waitingImportId ? await readWaitingImport(waitingImportId).catch(() => null) : null)
    if (own) return { source: own, check: checkAgainstSourceDocument(next, own) }
    return bestWaitingImport(next)
  }
  const inspect = (file: File) => {
    setPhase('inspecting')
    setProposal(null)
    setPaired(null)
    setPicked(null)
    setCropping(false)
    setResolutions(new Map())
    setSuppliedSource(null)
    setError(null)
    setNeedsConversion(false)
    setInspected({ fileName: file.name, kind: 'record' })
    void (async () => {
      const kind = kindOfFile(file)
      if (kind === 'photo' || kind === 'word') return startConverting(file)
      try {
        const next = await inspectUploadedFile(file)
        // JSON is an assistant's answer to a test being converted.
        const pairing = isRecordFile(file) ? await pairingFor(next) : null
        setProposal(next)
        setSelection(initialSelection(next, targetBankId ? { targetBankId } : {}))
        setNames(Object.fromEntries(next.banks.map((bank) => [bank.id, bank.record.bank.name])))
        // A Test is what a teacher converting a test came for, so it is what
        // the preview opens on when there is one.
        setFocus(next.exams[0] ? { kind: 'exam', key: next.exams[0].key } : { kind: 'bank', id: next.banks[0]!.id })
        if (pairing) {
          setWaiting(pairing.source)
          setPaired(pairing.check)
        }
        setPhase('choose')
      } catch (reason) {
        const code = reason instanceof Error && 'code' in reason ? reason.code : null
        if (!isRecordFile(file) && code === 'missing-attachment') return startConverting(file)
        failed(reason)
        setPhase('choose')
      }
    })()
  }

  const discard = async () => {
    if (waiting) await discardWaitingImport(waiting.id).catch(() => undefined)
    setWaiting(null)
  }

  const copyInstructions = () => {
    void navigator.clipboard.writeText(fillImageTags(extractInstructions, null)).then(() => setCopied(true))
  }

  /** Back from a review of the wrong file to the import that waits. */
  const chooseAnother = () => {
    setProposal(null)
    setSelection(null)
    setPaired(null)
    setPicked(null)
    setCropping(false)
    setResolutions(new Map())
    setError(null)
  }

  const inspectOnOpen = useRef(initialFile)
  useEffect(() => {
    const file = inspectOnOpen.current
    inspectOnOpen.current = undefined
    // Deliberately once, for the file the dialog was opened with. A later drop
    // opens the dialog again with a fresh key rather than mutating this one.
    if (file) inspect(file)
  }, [])

  const sources = useMemo(() => (proposal ? mediaSources(proposal) : new Map<string, string>()), [proposal])
  /** The proposal the preview draws: each Pending Image knows its key. */
  const previewProposal = useMemo(
    () => proposal && { ...proposal, banks: proposal.banks.map((bank) => ({ ...bank, record: withPendingKeys(bank.id, bank.record) })) },
    [proposal],
  )

  const bankName = (id: string) => {
    const bank = proposal?.banks.find((item) => item.id === id)
    return bank?.record.bank.name || 'Untitled Question Bank'
  }
  const examName = (key: string) =>
    proposal?.exams.find((item) => item.key === key)?.name || 'Untitled Test'

  const counts = proposal && selection ? importCounts(proposal, selection) : null
  const importable = selection ? hasAllowedItems(selection) : false
  const occurrences = useMemo(
    () => (proposal && selection ? pendingImagesOf(proposal, (id) => selection.banks[id]?.allowed ?? false) : []),
    [proposal, selection],
  )
  const resolvingSource: ResolvingSource | null = paired && waiting ? waiting : suppliedSource
  const mismatch = paired !== null && !paired.matches
  const choice = usePictureChoice(occurrences, resolutions, setResolutions)
  const pickedOccurrence = occurrences.find(({ key }) => key === picked)

  /** Each Pending Image's picture, at the size it will be imported at. */
  const pictures = useMemo(() => {
    const drawn = new Map<string, PreviewPicture>()
    for (const occurrence of occurrences) {
      const picture = resolutions.get(occurrence.key)
      if (!picture) continue
      const ratio = estimatedSize(picture, occurrence)
      drawn.set(occurrence.key, { src: pictureSource(picture.asset), ...(ratio !== undefined ? { ratio } : {}) })
    }
    return drawn
  }, [occurrences, resolutions])
  const previewDocument = useMemo(
    () => (document: SemanticDocument) =>
      recordDocumentToEditorNodes(document).map((node) => resolveMedia(node, sources, pictures)),
    [sources, pictures],
  )

  /** Take every tagged picture out of the Source Document, for each Pending
   *  Image that has none yet. */
  const fill = (source: ResolvingSource) => {
    const unfilled = occurrences.filter(({ key }) => !resolutions.has(key))
    if (unfilled.length === 0) return
    setFilling(true)
    void prefilledPictures(unfilled, source)
      .then((filled) => setResolutions((current) => new Map([...filled, ...current])))
      .finally(() => setFilling(false))
  }
  // The pictures are filled in as soon as the file is shown — unless it seems
  // to come from another test, when the teacher asks for them.
  const filledFor = useRef<unknown>(null)
  useEffect(() => {
    if (!proposal || !resolvingSource || mismatch || filledFor.current === proposal) return
    filledFor.current = proposal
    fill(resolvingSource)
  })

  const supplySource = async (file: File) => {
    setError(null)
    setFilling(true)
    try {
      const source = await readSourceDocument(file)
      setSuppliedSource(source)
      const filled = await prefilledPictures(occurrences.filter(({ key }) => !resolutions.has(key)), source)
      setResolutions((current) => new Map([...filled, ...current]))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That PDF could not be read.')
    } finally {
      setFilling(false)
    }
  }

  const confirm = async () => {
    if (!proposal || !selection || busy || !importable) return
    setPhase('saving')
    setError(null)
    try {
      await onImport(proposal, selection, {
        resolution: resolutionOf(resolutions, occurrences),
        history: {
          ...(inspected ?? { fileName: 'Test Parrot file', kind: 'record' }),
          ...(paired && waiting ? { waitingImportId: waiting.id } : {}),
        },
      })
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message
          ? `Nothing was imported: ${reason.message}`
          : 'Nothing was imported. Check browser storage and try again.',
      )
      setPhase('choose')
    }
  }

  const focusedBank = focus?.kind === 'bank' ? proposal?.banks.find(({ id }) => id === focus.id) : undefined
  const focusedExam = focus?.kind === 'exam' ? proposal?.exams.find(({ key }) => key === focus.key) : undefined

  const entryId = (item: Focus) => `${listId}-${focusKey(item)}`
  const showItem = (next: Focus, moveFocus = false) => {
    setFocus(next)
    setPicked(null)
    setCropping(false)
    if (moveFocus) requestAnimationFrame(() => document.getElementById(entryId(next))?.focus())
  }

  const pick = (key: string) => {
    setPicked(key)
    setCropping(false)
  }
  const slot: PictureSlot = (key, picture, inline) => {
    const occurrence = occurrences.find((candidate) => candidate.key === key)
    if (!occurrence) return picture
    const resolved = resolutions.get(key)
    return <PreviewPictureButton
      occurrence={occurrence}
      resolved={resolved}
      source={resolvingSource}
      inline={inline}
      selected={picked === key}
      onPick={() => pick(key)}
    >
      {picture}
    </PreviewPictureButton>
  }
  const detected = occurrences.filter(({ key }) => resolutions.has(key)).length

  /** One kind's entries in the Import List: a section that opens and closes,
   *  headed by how many of that kind are coming, with a checkbox per item for
   *  whether it comes and the rest of the row for showing it. */
  const listSection = (
    kind: Kind,
    heading: string,
    items: { focus: Focus; name: string; detail: string; allowed: boolean; onAllow: (allowed: boolean) => void }[],
    coming: number,
  ) => {
    const { Icon } = KINDS[kind]
    return <details className="bank-import-list-section" data-kind={kind} open>
      <summary>
        <ChevronRight className="bank-import-list-chevron" aria-hidden="true" />
        <Icon aria-hidden="true" />
        <span>{heading}</span>
        <span className="badge bank-import-kind">
          {coming === items.length ? coming : `${coming} of ${items.length}`}
        </span>
      </summary>
      <ul>
        {items.map((item) => {
          const selected = focus !== null && focusKey(item.focus) === focusKey(focus)
          return <li key={focusKey(item.focus)} data-selected={selected ? 'true' : undefined} data-allowed={item.allowed ? 'true' : 'false'}>
            <input
              type="checkbox"
              checked={item.allowed}
              disabled={busy}
              aria-label={`Import ${item.name}`}
              onChange={(event) => item.onAllow(event.target.checked)}
            />
            <button
              id={entryId(item.focus)}
              type="button"
              className="bank-import-entry"
              aria-pressed={selected}
              aria-label={`Preview ${item.name}`}
              onClick={() => showItem(item.focus)}
            >
              <span>{item.name}</span>
              <small>{item.detail}</small>
            </button>
          </li>
        })}
      </ul>
    </details>
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialog}
        className={[
          'bank-import-dialog',
          proposal ? 'bank-import-dialog--review' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
      >
        <header className="dialog-header">
          <h2 id={titleId}>Import</h2>
        </header>

        {!proposal && waiting && (
          <div className="bank-import-choose">
            <SourceDocumentSteps
              waiting={waiting}
              named
              busy={busy}
              onReturnedFile={inspect}
              onStartOver={() => void discard()}
            />
          </div>
        )}

        {!proposal && !waiting && (
          <div className="bank-import-choose">
            {/* The whole dashed zone is the file control: dropping on it lands
                in the window-level drop target, clicking it opens the picker,
                and the input itself stays in the tab order under the zone. */}
            <label className="bank-import-drop">
              <input
                ref={input}
                type="file"
                aria-label="Your test PDF or a Test Parrot file"
                accept={`${TEST_FILE_TYPES},application/json,.json`}
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  // Cleared so that choosing the same file after an error, or
                  // after backing out of a review, is still a change event.
                  event.target.value = ''
                  if (file) inspect(file)
                }}
              />
              <UploadCloud aria-hidden="true" />
              <strong>Your test, or a Test Parrot file</strong>
              <span>A test to convert as a PDF, Word document or photo, a Question Bank or Test PDF, or a <code>.parrot.json</code> file</span>
              <span>Drop it here or click to choose one</span>
            </label>
            <div
              className="bank-import-assist"
              data-emphasis={needsConversion ? 'true' : undefined}
              role={needsConversion ? 'alert' : undefined}
            >
              <span>
                {needsConversion ? (
                  <>
                    <strong>That file isn’t a Test Parrot file yet.</strong>{' '}
                    Drop your test here as a PDF or Word document to keep its
                    pictures, or copy these instructions and give them to an AI
                    along with it — it will produce a file with your questions
                    and the test itself, ready to drop here.
                  </>
                ) : (
                  <>
                    Already have a test? Drop its PDF, Word document or a photo
                    here to keep its pictures. For pasted text, copy these
                    instructions for an AI to turn it into a file with your
                    questions and the test itself, ready to import here.
                  </>
                )}
              </span>
              <button
                type="button"
                className={needsConversion ? 'primary-button' : 'secondary-button'}
                disabled={busy}
                onClick={copyInstructions}
              >
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy instructions'}
              </button>
            </div>
          </div>
        )}

        <div
          className="bank-import-announcements"
          aria-live="polite"
          aria-atomic="true"
        >
          {phase === 'inspecting' && <p role="status">Validating file…</p>}
          {phase === 'analyzing' && <p role="status">Finding the pictures in your test…</p>}
          {phase === 'saving' && <p role="status">Importing…</p>}
          {error && !needsConversion && <p className="home-error" role="alert">{error}</p>}
        </div>

        {proposal && mismatch && waiting && (
          <div className="bank-import-mismatch" role="alert">
            <p>
              <strong>This file seems to come from a different test than {waiting.fileName}.</strong>{' '}
              {paired!.unknownTags.length > 0
                ? `It names ${paired!.unknownTags.map((tag) => `IMG ${tag}`).join(', ')}, which your test does not have. `
                : ''}
              {paired!.stemsChecked > 0 && paired!.stemsFound * 2 <= paired!.stemsChecked
                ? 'Most of its questions are not in your test. '
                : ''}
              You can import it anyway, or choose another file.
            </p>
            <span className="bank-import-assist-actions">
              {resolvingSource && occurrences.some(({ key }) => !resolutions.has(key)) && (
                <button type="button" className="secondary-button" disabled={busy || filling} onClick={() => fill(resolvingSource)}>
                  Use its pictures anyway
                </button>
              )}
              <button type="button" className="secondary-button" disabled={busy} onClick={chooseAnother}>
                Choose another file
              </button>
            </span>
          </div>
        )}

        {proposal && selection && focus && (
          <section className="bank-import-body" aria-label="Import confirmation">
            <nav className="bank-import-list" aria-labelledby={`${listId}-heading`}>
              <header>
                <h3 id={`${listId}-heading`}>Import List</h3>
                <p>This is the list that you’re going to import.</p>
              </header>
              {listSection(
                'bank',
                proposal.banks.length === 1 ? 'Question Bank' : 'Question Banks',
                proposal.banks.map((bank) => ({
                  focus: { kind: 'bank', id: bank.id },
                  name: bank.record.bank.name || 'Untitled Question Bank',
                  detail: plural(bank.record.bank.questions.length, 'Question'),
                  allowed: selection.banks[bank.id]!.allowed,
                  onAllow: (allowed) => setSelection(setBankAllowed(proposal, selection, bank.id, allowed)),
                })),
                counts?.banks ?? 0,
              )}
              {proposal.exams.length > 0 && listSection(
                'exam',
                proposal.exams.length === 1 ? 'Test' : 'Tests',
                proposal.exams.map((exam) => ({
                  focus: { kind: 'exam', key: exam.key },
                  name: exam.name || 'Untitled Test',
                  // A Test left out because a bank it needs is left out says so
                  // on its own row, where the checkbox that fixes it is.
                  detail: deniedBanksOf(proposal, selection, exam.key).length > 0
                    ? `Needs ${deniedBanksOf(proposal, selection, exam.key).map(bankName).join(' and ')}`
                    : plural(exam.positions.length, 'Question'),
                  allowed: selection.exams[exam.key]!.allowed,
                  onAllow: (allowed) => setSelection(setExamAllowed(proposal, selection, exam.key, allowed)),
                })),
                counts?.exams ?? 0,
              )}
            </nav>

            <div
              className="bank-import-preview"
              data-kind={focusedExam ? 'exam' : 'bank'}
              aria-label={focusedExam ? 'Test preview' : 'Question Bank preview'}
            >
              {occurrences.length > 0 && !cropping && (
                <p className="bank-import-picture-hint" role="status">
                  <ImageIcon aria-hidden="true" />
                  <span>
                    {filling
                      ? `Finding your pictures in ${resolvingSource?.fileName ?? 'your test'}…`
                      : detected > 0
                        ? `${detected === occurrences.length ? `All ${plural(detected, 'picture')}` : `${detected} of ${plural(occurrences.length, 'picture')}`} detected from ${resolvingSource?.fileName ?? 'your test'}. Click a picture to change it.`
                        : `${plural(occurrences.length, 'picture')} needed. Click one to add it, or add them after importing.`}
                  </span>
                </p>
              )}
              {cropping && pickedOccurrence && resolvingSource
                ? <PageCropper
                    key={pickedOccurrence.key}
                    source={resolvingSource}
                    startPage={namedPage(pickedOccurrence, resolvingSource)}
                    onCancel={() => setCropping(false)}
                    onCrop={(page, box) =>
                      void choice
                        .run(pickedOccurrence, () => cropChoice(resolvingSource, page, box))
                        .then((done) => { if (done) setCropping(false) })}
                  />
                : <PictureSlotContext.Provider value={slot}>
                    {focusedBank && previewProposal && (
                      <BankPreview
                        bank={previewProposal.banks.find(({ id }) => id === focusedBank.id)!}
                        previewDocument={previewDocument}
                      />
                    )}
                    {focusedExam && previewProposal && (
                      <ExamPreview proposal={previewProposal} exam={focusedExam} sources={sources} pictures={pictures} />
                    )}
                  </PictureSlotContext.Provider>}
            </div>

            {pickedOccurrence && (
              <aside className="bank-import-controls bank-import-picture" aria-label={`Picture for ${placeName(pickedOccurrence)}`}>
                <header className="bank-import-rail-head" data-kind="picture">
                  <p><ImageIcon aria-hidden="true" />Picture</p>
                  {/* Named by what it shows: a Test numbers its Questions by
                      Section, so the bank's number would name another one. */}
                  <h3>{pickedOccurrence.caption || pickedOccurrence.alt || 'Picture'}</h3>
                </header>
                {choice.error && <p className="home-error" role="alert">{choice.error}</p>}
                <PictureChoices
                  key={pickedOccurrence.key}
                  occurrence={pickedOccurrence}
                  occurrences={occurrences}
                  source={resolvingSource}
                  resolutions={resolutions}
                  choice={choice}
                  onCrop={() => setCropping(true)}
                  described={false}
                  onSourceFile={(file) => void supplySource(file)}
                />
                <button type="button" className="primary-button bank-import-picture-done" onClick={() => { setPicked(null); setCropping(false) }}>
                  Done
                </button>
              </aside>
            )}

            {!pickedOccurrence && focusedBank && (() => {
              const bank = focusedBank
              const chosen = selection.banks[bank.id]!
              const name = bank.record.bank.name || 'Untitled Question Bank'
              const targetName = names[bank.id] ?? ''
              const fallbackExisting = targetBankId ?? existingBanks[0]?.id
              return <aside
                className="bank-import-controls"
                data-allowed={chosen.allowed ? 'true' : 'false'}
                aria-label={`Question Bank ${name}`}
              >
                <RailHead kind="bank" name={name} allowed={chosen.allowed} />

                <BankSummary
                  bank={bank}
                  picturesNeeded={occurrences.filter(({ bankId, key }) => bankId === bank.id && !resolutions.has(key)).length}
                />

                {proposal.exams.length > 0 && <section className="bank-import-uses">
                  <h4>Used by</h4>
                  {bank.exams.length > 0
                    ? bank.exams.map((key) => (
                        <TabLink
                          key={key}
                          kind="exam"
                          name={examName(key)}
                          onShow={() => showItem({ kind: 'exam', key }, true)}
                        />
                      ))
                    : <p>No Test in this file</p>}
                </section>}

                {/* Where the bank goes is a setting of the import, not a fact
                    about the bank, so it comes after everything that is. */}
                {chosen.allowed && <fieldset className="bank-import-target" disabled={busy}>
                  <legend>Import settings</legend>
                  <label>
                    <input
                      type="radio"
                      name={`target-${bank.id}`}
                      checked={chosen.target.kind === 'new'}
                      onChange={() => setSelection(setBankTarget(selection, bank.id, { kind: 'new', name: targetName }))}
                    />
                    <span>Create new question bank</span>
                  </label>
                  {chosen.target.kind === 'new' && <input
                    className="bank-import-target-name"
                    aria-label={`New Question Bank name for ${name}`}
                    value={targetName}
                    onChange={(event) => {
                      setNames({ ...names, [bank.id]: event.target.value })
                      setSelection(setBankTarget(selection, bank.id, { kind: 'new', name: event.target.value }))
                    }}
                  />}
                  <label>
                    <input
                      type="radio"
                      name={`target-${bank.id}`}
                      checked={chosen.target.kind === 'existing'}
                      disabled={!fallbackExisting}
                      onChange={() => fallbackExisting && setSelection(setBankTarget(selection, bank.id, { kind: 'existing', bankId: fallbackExisting }))}
                    />
                    <span>Add to an existing one</span>
                  </label>
                  {chosen.target.kind === 'existing' && <select
                    className="bank-import-target-bank"
                    aria-label={`Existing Question Bank for ${name}`}
                    value={chosen.target.bankId}
                    onChange={(event) => setSelection(setBankTarget(selection, bank.id, { kind: 'existing', bankId: event.target.value }))}
                  >
                    {!existingBanks.some(({ id }) => id === (chosen.target as { bankId: string }).bankId) && (
                      <option value={chosen.target.bankId}>This Question Bank</option>
                    )}
                    {existingBanks.map((existing) => (
                      <option key={existing.id} value={existing.id}>{existing.name}</option>
                    ))}
                  </select>}
                </fieldset>}
              </aside>
            })()}

            {!pickedOccurrence && focusedExam && (() => {
              const exam = focusedExam
              const chosen = selection.exams[exam.key]!
              const name = exam.name || 'Untitled Test'
              const denied = deniedBanksOf(proposal, selection, exam.key)
              return <aside
                className="bank-import-controls"
                data-allowed={chosen.allowed ? 'true' : 'false'}
                aria-label={`Test ${name}`}
              >
                <RailHead kind="exam" name={name} allowed={chosen.allowed} />
                {!chosen.allowed && denied.length > 0 && <p className="bank-import-denied-reason">
                  Not imported because {denied.map(bankName).join(' and ')} {denied.length === 1 ? 'is' : 'are'} not being imported.
                </p>}

                <dl className="bank-import-summary">
                  {(() => {
                    const counts = examTypeCounts(proposal, exam)
                    return RECORD_TYPE_ORDER.map((type) => (
                      <div key={type}>
                        <dt>{RECORD_TYPE_LABELS[type]}</dt>
                        <dd>{counts[type]}</dd>
                      </div>
                    ))
                  })()}
                  <div>
                    <dt>Format version</dt>
                    <dd>{exam.formatVersion}</dd>
                  </div>
                </dl>

                <section className="bank-import-uses">
                  <h4>Questions from</h4>
                  {exam.banks.map((id) => (
                    <TabLink
                      key={id}
                      kind="bank"
                      onShow={() => showItem({ kind: 'bank', id }, true)}
                      name={bankName(id)}
                      detail={plural(
                        exam.positions.filter(({ question }) => question.bank === id).length,
                        'Question',
                      )}
                    />
                  ))}
                </section>
              </aside>
            })()}
          </section>
        )}

        <footer className="dialog-actions">
          {proposal && selection && (
            <p className="bank-import-outcome" id={`${listId}-outcome`}>
              {importSentence(
                proposal,
                selection,
                (id) => existingBanks.find((existing) => existing.id === id)?.name ?? 'this Question Bank',
              )}
            </p>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
          >
            {waiting && !proposal ? 'Close' : 'Cancel'}
          </button>
          {proposal && selection && (
            <button
              type="button"
              className="primary-button"
              disabled={busy || !importable || filling}
              aria-describedby={`${listId}-outcome`}
              onClick={() => void confirm()}
            >
              {phase === 'saving' ? 'Importing…' : mismatch ? 'Import anyway' : 'Import'}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}

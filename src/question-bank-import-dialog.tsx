import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Copy, Download, FileText, Library, UploadCloud, type LucideIcon } from 'lucide-react'
import extractInstructions from '../public/extract.md?raw'
import { fillImageTags } from './image-tag-list'
import {
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
import type { ProseMirrorJSON } from './question-doc'
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
import { checkAgainstSourceDocument, pendingImagesOf, type PendingImageResolution, type SourceDocumentCheck } from './pending-images'
import { ResolveImages } from './resolve-images'
import { acceptedPictures, prefilledPictures, type Resolutions, type ResolvingSource } from './resolved-pictures'
import { discardWaitingImport, readWaitingImport, saveWaitingImport, type WaitingImport } from './waiting-import'
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

/**
 * Point a preview document's images at the bytes the file carries.
 *
 * `recordDocumentToEditorNodes` addresses an image as `/local-images/<hash>`,
 * which resolves only for media that already lives here. Nothing has been
 * imported yet, so the preview would draw every image broken; the file's own
 * Media Assets are the only copy that exists, and they are already base64.
 */
function resolveMedia(
  node: ProseMirrorJSON,
  sources: ReadonlyMap<string, string>,
): ProseMirrorJSON {
  const attrs = node.attrs as Record<string, unknown> | null | undefined
  const resolved =
    attrs && typeof attrs.src === 'string' ? sources.get(attrs.src) : undefined
  return {
    ...node,
    ...(resolved ? { attrs: { ...attrs, src: resolved } } : {}),
    ...(Array.isArray(node.content)
      ? {
          content: (node.content as ProseMirrorJSON[]).map((child) =>
            resolveMedia(child, sources),
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
): Promise<LayoutPlan | null> {
  // Loaded on demand, like the importer: it brings the record parsers.
  const { planImport } = await import('./package-commit')
  let next = 0
  const plan = planImport(proposal, initialSelection(proposal), () => `preview-${next++}`)
  const planned = plan.exams.find(({ source }) => source === examKey)
  if (!planned || planned.saved.workingCopy.questionIds.length === 0) return null
  const resolve = (question: Question): Question => ({
    ...question,
    doc: resolveMedia(question.doc, sources),
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
}: {
  proposal: ImportProposal
  exam: ProposedExam
  sources: ReadonlyMap<string, string>
}) {
  const [plan, setPlan] = useState<LayoutPlan | null | 'loading'>('loading')
  useEffect(() => {
    let current = true
    setPlan('loading')
    examPreviewPlan(proposal, exam.key, sources)
      .catch(() => null)
      .then((next) => { if (current) setPlan(next) })
    return () => { current = false }
  }, [proposal, exam.key, sources])
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
function BankSummary({ bank }: { bank: ProposedBank }) {
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
      {summary.pendingImages > 0 && (
        <div className="is-warning">
          <dt>Pictures needed</dt>
          <dd>{summary.pendingImages}</dd>
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

const focusKey = (focus: Focus) => (focus.kind === 'bank' ? `bank:${focus.id}` : `exam:${focus.key}`)

export function QuestionBankImportDialog({
  onClose,
  onImport,
  initialFile,
  targetBankId,
  loadBanks,
}: {
  onClose: () => void
  onImport: (
    proposal: ImportProposal,
    selection: ImportSelection,
    options: { resolution: PendingImageResolution; finishesWaitingImport: boolean },
  ) => Promise<void>
  /** A file already chosen elsewhere — dropped onto the page — inspected as
   *  soon as the dialog opens rather than asked for again. */
  initialFile?: File
  /** The bank the import was started from, which every bank in the file
   *  defaults to adding into. */
  targetBankId?: string
  /** The banks on this device, for “Add to an existing one”. */
  loadBanks: () => Promise<readonly { id: string; name: string }[]>
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
  /** The import waiting for an assistant, resumed whenever the dialog opens. */
  const [waiting, setWaiting] = useState<WaitingImport | null>(null)
  /** A new Source Document dropped while another import waits, held until
   *  the teacher says whether it replaces that one. */
  const [replacing, setReplacing] = useState<File | null>(null)
  /** Set when the file under review was paired with the waiting import: how
   *  well it matches the Source Document. */
  const [paired, setPaired] = useState<SourceDocumentCheck | null>(null)
  const [resolving, setResolving] = useState(false)
  const [filling, setFilling] = useState(false)
  const [resolutions, setResolutions] = useState<Resolutions>(new Map())
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])
  const busy = phase !== 'choose'
  const busyRef = useRef(busy)
  busyRef.current = busy
  useModalScrollLock()

  useEffect(() => {
    let current = true
    void loadBanks().then((banks) => { if (current) setExistingBanks(banks) }, () => undefined)
    return () => { current = false }
  }, [loadBanks])

  useEffect(() => {
    let current = true
    void readWaitingImport().then((found) => { if (current && found) setWaiting(found) }, () => undefined)
    return () => { current = false }
  }, [])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => input.current?.focus())
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
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
    setReplacing(null)
    setPhase('analyzing')
    setError(null)
    setNeedsConversion(false)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { analyzeSourceDocument } = await import('./source-document')
      const analysis = await analyzeSourceDocument(bytes)
      const next: WaitingImport = { fileName: file.name, bytes, ...analysis, createdAt: new Date().toISOString() }
      await saveWaitingImport(next)
      setWaiting(next)
    } catch (reason) {
      failed(reason)
    } finally {
      setPhase('choose')
    }
  }

  const inspect = (file: File) => {
    setPhase('inspecting')
    setProposal(null)
    setPaired(null)
    setResolving(false)
    setResolutions(new Map())
    setError(null)
    setNeedsConversion(false)
    void (async () => {
      try {
        const next = await inspectUploadedFile(file)
        // JSON dropped while an import waits is the assistant's answer to
        // it: the two are paired with nothing but that.
        const source = isRecordFile(file) ? await readWaitingImport().catch(() => null) : null
        setProposal(next)
        setSelection(initialSelection(next, targetBankId ? { targetBankId } : {}))
        setNames(Object.fromEntries(next.banks.map((bank) => [bank.id, bank.record.bank.name])))
        // A Test is what a teacher converting a test came for, so it is what
        // the preview opens on when there is one.
        setFocus(next.exams[0] ? { kind: 'exam', key: next.exams[0].key } : { kind: 'bank', id: next.banks[0]!.id })
        if (source) {
          setWaiting(source)
          setPaired(checkAgainstSourceDocument(next, source))
        }
        setPhase('choose')
      } catch (reason) {
        const code = reason instanceof Error && 'code' in reason ? reason.code : null
        if (!isRecordFile(file) && code === 'missing-attachment') {
          const existing = await readWaitingImport().catch(() => null)
          if (existing) {
            setWaiting(existing)
            setReplacing(file)
            setPhase('choose')
            return
          }
          await startSourceDocument(file)
          return
        }
        failed(reason)
        setPhase('choose')
      }
    })()
  }

  const discard = async () => {
    await discardWaitingImport().catch(() => undefined)
    setWaiting(null)
    setReplacing(null)
  }

  const downloadLabeled = async () => {
    if (!waiting) return
    setError(null)
    try {
      const [{ labelSourceDocument, labeledFilename }, { browserPdfFonts }] = await Promise.all([
        import('./source-document'),
        import('./pdf-export'),
      ])
      const bytes = await labelSourceDocument(waiting.bytes, waiting.tags, browserPdfFonts)
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' }))
      const link = document.createElement('a')
      link.href = url
      link.download = labeledFilename(waiting.fileName)
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The labeled PDF could not be made.')
    }
  }

  const copyInstructions = (tags: WaitingImport['tags'] | null) => {
    void navigator.clipboard.writeText(fillImageTags(extractInstructions, tags)).then(() => setCopied(true))
  }

  /** Back from a review of the wrong file to the import that waits. */
  const chooseAnother = () => {
    setProposal(null)
    setSelection(null)
    setPaired(null)
    setResolving(false)
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
  const previewDocument = useMemo(
    () => (document: SemanticDocument) =>
      recordDocumentToEditorNodes(document).map((node) => resolveMedia(node, sources)),
    [sources],
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
  const resolvingSource: ResolvingSource | null = paired && waiting ? waiting : null
  const mismatch = paired !== null && !paired.matches

  const startResolving = () => {
    setResolving(true)
    if (!resolvingSource) return
    const unfilled = occurrences.filter(({ key }) => !resolutions.has(key))
    if (unfilled.length === 0) return
    setFilling(true)
    void prefilledPictures(unfilled, resolvingSource, !mismatch)
      .then((filled) => setResolutions((current) => new Map([...filled, ...current])))
      .finally(() => setFilling(false))
  }

  const confirm = async () => {
    if (!proposal || !selection || busy || !importable) return
    setPhase('saving')
    setError(null)
    try {
      await onImport(proposal, selection, {
        resolution: resolving ? acceptedPictures(resolutions) : new Map(),
        finishesWaitingImport: paired !== null,
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
    if (moveFocus) requestAnimationFrame(() => document.getElementById(entryId(next))?.focus())
  }

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
          proposal && resolving ? 'bank-import-dialog--resolve' : '',
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

        {!proposal && replacing && waiting && (
          <div className="bank-import-choose">
            <div className="bank-import-assist" data-emphasis="true" role="alert">
              <span>
                <strong>An import is already waiting for {waiting.fileName}.</strong>{' '}
                Start a new one from {replacing.name} instead? The waiting import
                and its PDF will be removed from this browser.
              </span>
              <span className="bank-import-assist-actions">
                <button type="button" className="secondary-button" disabled={busy} onClick={() => setReplacing(null)}>
                  Keep waiting import
                </button>
                <button type="button" className="primary-button" disabled={busy} onClick={() => void startSourceDocument(replacing)}>
                  Replace it
                </button>
              </span>
            </div>
          </div>
        )}

        {!proposal && !replacing && waiting && (
          <div className="bank-import-choose source-document-waiting" aria-label="Waiting for your AI assistant" role="region">
            <p className="source-document-found" role="status">
              Found {plural(waiting.tags.length, 'picture')} in {waiting.fileName}.
            </p>
            <p className="source-document-note">
              Test Parrot numbered each picture on a labeled copy of your PDF, so an
              AI assistant can say which picture goes where. Your PDF stays in this
              browser only until this import finishes, for at most seven days.
            </p>
            <ol className="source-document-steps">
              <li>
                <span><strong>Download the labeled PDF</strong> and attach it to your AI chat.</span>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => void downloadLabeled()}>
                  <Download aria-hidden="true" />Download labeled PDF
                </button>
              </li>
              <li>
                <span><strong>Copy the instructions</strong>, which list those picture numbers, and paste them in the same chat.</span>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => copyInstructions(waiting.tags)}>
                  {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  {copied ? 'Copied' : 'Copy instructions'}
                </button>
              </li>
              <li><span><strong>Drop the JSON file</strong> the assistant gives back here.</span></li>
            </ol>
            <label className="bank-import-drop">
              <input
                ref={input}
                type="file"
                aria-label="JSON file from your AI assistant"
                accept="application/json,.json"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) inspect(file)
                }}
              />
              <UploadCloud aria-hidden="true" />
              <strong>JSON file from your AI assistant</strong>
              <span>Drop it here or click to choose it</span>
            </label>
            <p className="source-document-discard">
              <button type="button" className="link-button" disabled={busy} onClick={() => void discard()}>
                Discard this import
              </button>
            </p>
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
                accept="application/pdf,.pdf,application/json,.json"
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
              <strong>Your test as a PDF, or a Test Parrot file</strong>
              <span>A test to convert, a Question Bank or Test PDF, or a <code>.parrot.json</code> file</span>
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
                    Drop your test here as a PDF to keep its pictures, or copy
                    these instructions and give them to an AI along with a scan
                    or screenshot of it — it will produce a file with your
                    questions and the test itself, ready to drop here.
                  </>
                ) : (
                  <>
                    Already have a test? Drop its PDF here to keep its pictures.
                    For a photo, a Word document or pasted text, copy these
                    instructions for an AI to turn it into a file with your
                    questions and the test itself, ready to import here.
                  </>
                )}
              </span>
              <button
                type="button"
                className={needsConversion ? 'primary-button' : 'secondary-button'}
                disabled={busy}
                onClick={() => copyInstructions(null)}
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
          {phase === 'analyzing' && <p role="status">Finding the pictures in your PDF…</p>}
          {phase === 'saving' && <p role="status">Importing…</p>}
          {error && !needsConversion && <p className="home-error" role="alert">{error}</p>}
        </div>

        {proposal && mismatch && waiting && (
          <div className="bank-import-mismatch" role="alert">
            <p>
              <strong>This file seems to come from a different test than {waiting.fileName}.</strong>{' '}
              {paired!.unknownTags.length > 0
                ? `It names ${paired!.unknownTags.map((tag) => `IMG ${tag}`).join(', ')}, which your PDF does not have. `
                : ''}
              {paired!.stemsChecked > 0 && paired!.stemsFound * 2 <= paired!.stemsChecked
                ? 'Most of its questions are not in your PDF. '
                : ''}
              You can import it anyway, or choose another file.
            </p>
            <button type="button" className="secondary-button" disabled={busy} onClick={chooseAnother}>
              Choose another file
            </button>
          </div>
        )}

        {proposal && selection && resolving && (
          <div className="bank-import-resolve">
            <ResolveImages
              occurrences={occurrences}
              source={resolvingSource}
              resolutions={resolutions}
              onChange={setResolutions}
              filling={filling}
            />
          </div>
        )}

        {proposal && selection && focus && !resolving && (
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
              {focusedBank && <BankPreview bank={focusedBank} previewDocument={previewDocument} />}
              {focusedExam && <ExamPreview proposal={proposal} exam={focusedExam} sources={sources} />}
            </div>

            {focusedBank && (() => {
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

                <BankSummary bank={bank} />

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

            {focusedExam && (() => {
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
          {proposal && selection && resolving && (
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setResolving(false)}>
              Back
            </button>
          )}
          {proposal && selection && (occurrences.length === 0 || resolving) && (
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
          {proposal && selection && occurrences.length > 0 && !resolving && (
            <button
              type="button"
              className="primary-button"
              disabled={busy || !importable}
              onClick={startResolving}
            >
              {mismatch ? 'Continue anyway' : 'Resolve Images'}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}

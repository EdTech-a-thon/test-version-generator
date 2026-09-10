import type { RecentExam } from './exam-workspaces'
import type { QuestionBankCollectionItem } from './resource-collections'
import { DocView } from './doc-view'

function relativeTime(prefix: string, iso: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 60_000),
  )
  if (minutes === 0) return `${prefix} just now`
  if (minutes < 60)
    return `${prefix} ${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${prefix} ${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${prefix} ${days} day${days === 1 ? '' : 's'} ago`
}

export function ExamCard({
  exam,
  onOpen,
}: {
  exam: RecentExam
  onOpen: (id: string) => void
}) {
  return (
    <button
      type="button"
      className="resource-card exam-card"
      onClick={() => onOpen(exam.id)}
    >
      <span className="sr-only">Open {exam.title}. </span>
      <div
        className="exam-card-page"
        aria-label={
          exam.preview
            ? 'Working Copy first-page preview'
            : 'Empty page preview'
        }
      >
        {exam.preview ? (
          <div className="exam-card-preview-content">
            {exam.preview.map((content, index) => (
              <section key={index} aria-label={`Question ${index + 1}`}>
                <DocView content={content} />
              </section>
            ))}
          </div>
        ) : (
          <span className="empty-page-line">Empty Exam</span>
        )}
      </div>
      <div className="resource-card-body">
        <h2>{exam.title}</h2>
        <p>
          {exam.questionCount}{' '}
          {exam.questionCount === 1 ? 'Question' : 'Questions'}
        </p>
        {exam.unsaved && (
          <strong className="unsaved-badge">Unsaved changes</strong>
        )}
        <time dateTime={exam.lastOpenedAt}>
          {relativeTime('Opened', exam.lastOpenedAt)}
        </time>
      </div>
    </button>
  )
}

function usageLabel(item: QuestionBankCollectionItem['usage'][number]) {
  if (item.saved && item.workingCopy) return 'saved and Working Copy'
  return item.saved ? 'saved' : 'Working Copy'
}

export function QuestionBankCard({
  bank,
  onOpen,
  onOpenExam,
}: {
  bank: QuestionBankCollectionItem
  onOpen: (id: string) => void
  onOpenExam?: (id: string) => void
}) {
  return (
    <article className="resource-card question-bank-card">
      <button
        type="button"
        className="resource-card-main"
        onClick={() => onOpen(bank.id)}
      >
        <span className="sr-only">Open {bank.name}. </span>
        <h2 aria-hidden="true">{bank.name}</h2>
        <p>
          {bank.questionCount}{' '}
          {bank.questionCount === 1 ? 'Question' : 'Questions'}
        </p>
        <p className="topic-summary">
          {bank.topics.length > 0
            ? bank.topics.slice(0, 3).join(' · ')
            : 'No Topics'}
        </p>
        <time dateTime={bank.lastUpdatedAt}>
          {relativeTime('Updated', bank.lastUpdatedAt)}
        </time>
      </button>
      <details className="bank-usage">
        <summary>
          Used in {bank.usage.length}{' '}
          {bank.usage.length === 1 ? 'Exam' : 'Exams'}
        </summary>
        {bank.usage.length === 0 ? (
          <p>Not used in any Exams.</p>
        ) : (
          <ul>
            {bank.usage.map((item) => (
              <li key={item.examId}>
                {onOpenExam ? (
                  <button type="button" onClick={() => onOpenExam(item.examId)}>
                    {item.title}
                  </button>
                ) : (
                  <strong>{item.title}</strong>
                )}
                <span>{usageLabel(item)}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </article>
  )
}

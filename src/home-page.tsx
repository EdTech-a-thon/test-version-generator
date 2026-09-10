import type { RecentExam } from './exam-workspaces'
import type { QuestionBankSummary } from './question-bank-workspaces'
import { Link } from './site-chrome'

function openedAt(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  return minutes === 0 ? 'Opened just now' : `Opened ${minutes} minute${minutes === 1 ? '' : 's'} ago`
}
function updatedAt(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  return minutes === 0 ? 'Updated just now' : `Updated ${minutes} minute${minutes === 1 ? '' : 's'} ago`
}

export function HomePage({ exams, banks, error, onNewExam, onOpen, onNewBank, onOpenBank }: {
  exams: readonly RecentExam[]
  banks: readonly QuestionBankSummary[]
  error: string | null
  onNewExam: () => void
  onOpen: (id: string) => void
  onNewBank: () => void
  onOpenBank: (id: string) => void
}) {
  return <div className="home-page">
    <header className="document-bar">
      <Link href="/" className="site-wordmark"><img className="app-logo" src="/logo.png" alt="" width={36} height={36} />Test Parrot</Link>
      <button type="button" className="export-button" onClick={onNewExam}>New Exam</button>
    </header>
    <main className="home-main">
      <div className="home-heading"><div><h1>Recent Exams</h1><p>Start a new exam or pick up where you left off.</p></div><button type="button" className="primary-button" onClick={onNewExam}>New Exam</button></div>
      {error && <p className="home-error" role="alert">{error}</p>}
      {exams.length === 0 ? <section className="home-empty" aria-label="Recent Exams"><h2>No recent Exams</h2><p>Your Exams will appear here after you create one.</p><button type="button" className="primary-button" onClick={onNewExam}>Create your first Exam</button></section> :
        <section className="exam-cards" aria-label="Recent Exams">{exams.map((exam) => <button type="button" className="exam-card" key={exam.id} onClick={() => onOpen(exam.id)}><h2>{exam.title}</h2><p>{exam.questionCount} {exam.questionCount === 1 ? 'Question' : 'Questions'}</p><p className="exam-card-preview">{exam.preview ?? 'Empty Exam'}</p><time dateTime={exam.lastOpenedAt}>{openedAt(exam.lastOpenedAt)}</time></button>)}</section>}
      <div className="home-heading home-heading-section"><div><h1>Recently Updated Question Banks</h1><p>Create reusable Questions without starting an Exam.</p></div><button type="button" className="primary-button" onClick={onNewBank}>New Question Bank</button></div>
      {banks.length === 0 ? <section className="home-empty" aria-label="Recently Updated Question Banks"><h2>No Question Banks</h2><p>Your Question Banks will appear here after you create one.</p><button type="button" className="primary-button" onClick={onNewBank}>Create your first Question Bank</button></section> :
        <section className="exam-cards" aria-label="Recently Updated Question Banks">{banks.map((bank) => <button type="button" className="exam-card question-bank-card" key={bank.id} onClick={() => onOpenBank(bank.id)}><h2>{bank.name}</h2><p>{bank.questionCount} {bank.questionCount === 1 ? 'Question' : 'Questions'}</p><p className="exam-card-preview">{bank.topics.length > 0 ? bank.topics.slice(0, 3).join(' · ') : 'No Topics'}</p><time dateTime={bank.lastUpdatedAt}>{updatedAt(bank.lastUpdatedAt)}</time></button>)}</section>}
    </main>
  </div>
}

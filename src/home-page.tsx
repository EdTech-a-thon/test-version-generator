import type { RecentExam } from './exam-workspaces'
import { Link } from './site-chrome'

function openedAt(iso: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000))
  return minutes === 0 ? 'Opened just now' : `Opened ${minutes} minute${minutes === 1 ? '' : 's'} ago`
}
export function HomePage({ exams, error, onNewExam, onOpen }: {
  exams: readonly RecentExam[]
  error: string | null
  onNewExam: () => void
  onOpen: (id: string) => void
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
    </main>
  </div>
}

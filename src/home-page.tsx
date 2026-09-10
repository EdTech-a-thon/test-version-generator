import type { RecentExam } from './exam-workspaces'
import type { PersistentStorageStatus } from './durable-storage'
import type { QuestionBankCollectionItem } from './resource-collections'
import { homePreview } from './resource-collections'
import { ExamCard, QuestionBankCard } from './resource-cards'
import { Footer, Link } from './site-chrome'

function SectionHeading({ title, description, newLabel, allHref, onNew }: {
  title: string
  description: string
  newLabel: string
  allHref: string
  onNew: () => void
}) {
  return <div className="home-heading">
    <div><h1>{title}</h1><p>{description}</p></div>
    <div className="home-heading-actions">
      <button type="button" className="primary-button" onClick={onNew}>{newLabel}</button>
      <Link href={allHref} className="secondary-button">View all {title}</Link>
    </div>
  </div>
}

export function HomePage({ exams, banks, error, persistentStorage, onNewExam, onOpen, onNewBank, onOpenBank, onDeleteBank }: {
  exams: readonly RecentExam[]
  banks: readonly QuestionBankCollectionItem[]
  error: string | null
  persistentStorage: PersistentStorageStatus
  onNewExam: () => void
  onOpen: (id: string) => void
  onNewBank: () => void
  onOpenBank: (id: string) => void
  onDeleteBank: (bank: QuestionBankCollectionItem) => void
}) {
  const recentExams = homePreview(exams)
  const recentBanks = homePreview(banks)
  return <div className="home-page">
    <header className="document-bar">
      <Link href="/" className="site-wordmark"><img className="app-logo" src="/logo.png" alt="" width={36} height={36} />Test Parrot</Link>
      <button type="button" className="export-button" onClick={onNewExam}>New Exam</button>
    </header>
    <main className="home-main">
      {error && <p className="home-error" role="alert">{error}</p>}
      <section className="storage-summary" aria-labelledby="storage-heading">
        <h1 id="storage-heading">Your work stays in this browser</h1>
        <p>Exams, Question Banks, Working Copies, and Export History are stored locally on this device, not in the cloud. Keep external copies of important work.</p>
        {persistentStorage === 'denied' && <p className="storage-warning" role="status">Persistent storage was denied. Your browser may clear this local data when space is needed.</p>}
        {persistentStorage === 'granted' && <p className="storage-status">Persistent browser storage is enabled.</p>}
      </section>

      <section className="home-resource-section" aria-labelledby="recent-exams-heading">
        <SectionHeading title="Recent Exams" description="Start a new Exam or pick up where you left off." newLabel="New Exam" allHref="/exams" onNew={onNewExam} />
        <span id="recent-exams-heading" className="sr-only">Recent Exams</span>
        {recentExams.length === 0 ? <div className="home-empty"><h2>No recent Exams</h2><p>Your Exams will appear here after you create one.</p><button type="button" className="primary-button" onClick={onNewExam}>Create your first Exam</button></div> :
          <div className="resource-row" role="list" aria-label="Recent Exams">{recentExams.map((exam) => <div role="listitem" key={exam.id}><ExamCard exam={exam} onOpen={onOpen} /></div>)}</div>}
      </section>

      <section className="home-resource-section" aria-labelledby="recent-banks-heading">
        <SectionHeading title="Recently Updated Question Banks" description="Create reusable Questions without starting an Exam." newLabel="New Question Bank" allHref="/question-banks" onNew={onNewBank} />
        <span id="recent-banks-heading" className="sr-only">Recently Updated Question Banks</span>
        {recentBanks.length === 0 ? <div className="home-empty"><h2>No Question Banks</h2><p>Your Question Banks will appear here after you create one.</p><button type="button" className="primary-button" onClick={onNewBank}>Create your first Question Bank</button></div> :
          <div className="resource-row" role="list" aria-label="Recently Updated Question Banks">{recentBanks.map((bank) => <div role="listitem" key={bank.id}><QuestionBankCard bank={bank} onOpen={onOpenBank} onOpenExam={onOpen} onDelete={onDeleteBank} /></div>)}</div>}
      </section>
    </main>
    <Footer />
  </div>
}

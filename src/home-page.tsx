import type { RecentExam } from './exam-workspaces'
import type { PersistentStorageStatus } from './durable-storage'
import type { QuestionBankCollectionItem } from './resource-collections'
import { homePreview } from './resource-collections'
import { ExamCard, NewResourceCard, QuestionBankCard, ResourceCarousel } from './resource-cards'
import { AppShell } from './app-shell'

/**
 * Home is a resume surface and nothing else: a shelf of the Exams you were
 * working on, then every Question Bank you have. There is nothing to explain
 * and nothing to label twice — the left nav already says where things live, so
 * each section gets a quiet label rather than a title. Each shelf starts with
 * the dotted card that creates its next resource, which is also all an empty
 * shelf shows; the only button is Import, because a Question Bank made
 * elsewhere has nowhere on the shelf to come from.
 */
export function HomePage({
  exams,
  banks,
  error,
  persistentStorage,
  onNewExam,
  onOpen,
  onNewBank,
  onImportBank,
  onOpenBank,
  onDeleteBank,
}: {
  exams: readonly RecentExam[]
  banks: readonly QuestionBankCollectionItem[]
  error: string | null
  persistentStorage: PersistentStorageStatus
  onNewExam: () => void
  onOpen: (id: string) => void
  onNewBank: () => void
  onImportBank: () => void
  onOpenBank: (id: string) => void
  onDeleteBank: (bank: QuestionBankCollectionItem) => void
}) {
  const recentExams = homePreview(exams)
  return (
    <AppShell crumbs={[{ label: 'Home' }]} persistentStorage={persistentStorage}>
      {error && (
        <p className="home-error" role="alert">
          {error}
        </p>
      )}

      <section className="home-shelf" aria-labelledby="recent-exams-heading">
        <ResourceCarousel
          label="Recent Exams"
          heading={
            <h1 id="recent-exams-heading" className="shelf-label">
              Pick up where you left off
            </h1>
          }
        >
          <div role="listitem">
            <NewResourceCard label="New Exam" shape="sheet" onClick={onNewExam} />
          </div>
          {recentExams.map((exam) => (
            <div role="listitem" key={exam.id}>
              <ExamCard exam={exam} onOpen={onOpen} />
            </div>
          ))}
        </ResourceCarousel>
      </section>

      <section className="home-shelf" aria-labelledby="question-banks-heading">
        <div className="shelf-bar">
          <h2 id="question-banks-heading" className="shelf-label">
            Question Banks
          </h2>
          <button type="button" className="secondary-button" onClick={onImportBank}>
            Import Question Bank
          </button>
        </div>
        <div className="collection-grid">
          <NewResourceCard label="New Question Bank" shape="card" onClick={onNewBank} />
          {banks.map((bank) => (
            <QuestionBankCard
              key={bank.id}
              bank={bank}
              onOpen={onOpenBank}
              onDelete={onDeleteBank}
            />
          ))}
        </div>
      </section>

    </AppShell>
  )
}

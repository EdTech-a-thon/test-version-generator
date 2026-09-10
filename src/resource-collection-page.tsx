import { useMemo, useState } from 'react'
import type { RecentExam } from './exam-workspaces'
import { ExamCard, QuestionBankCard } from './resource-cards'
import {
  filterExamCollection,
  filterQuestionBankCollection,
  type QuestionBankCollectionItem,
} from './resource-collections'
import { Footer, SiteHeader } from './site-chrome'

export function ResourceCollectionPage({
  kind,
  exams,
  banks,
  onOpenExam,
  onOpenBank,
  onDeleteBank,
}: {
  kind: 'exams' | 'question-banks'
  exams: readonly RecentExam[]
  banks: readonly QuestionBankCollectionItem[]
  onOpenExam: (id: string) => void
  onOpenBank: (id: string) => void
  onDeleteBank?: (bank: QuestionBankCollectionItem) => void
}) {
  const [query, setQuery] = useState('')
  const shownExams = useMemo(
    () => filterExamCollection(exams, query),
    [exams, query],
  )
  const shownBanks = useMemo(
    () => filterQuestionBankCollection(banks, query),
    [banks, query],
  )
  const isExams = kind === 'exams'
  const resources = isExams ? shownExams : shownBanks
  const resourceName = isExams ? 'Exams' : 'Question Banks'

  return (
    <div className="site-page collection-page">
      <SiteHeader />
      <main className="collection-main">
        <header className="collection-heading">
          <div>
            <h1>All {resourceName}</h1>
            <p>
              {isExams
                ? 'Open any Exam or Working Copy in this browser.'
                : 'Find a Question Bank by name or Topic.'}
            </p>
          </div>
          <label className="collection-search">
            <span className="sr-only">Search {resourceName}</span>
            <input
              type="search"
              autoFocus
              placeholder={`Search ${resourceName}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </header>
        <p className="collection-count" role="status" aria-live="polite">
          {resources.length}{' '}
          {resources.length === 1
            ? resourceName.replace(/s$/, '')
            : resourceName}
        </p>
        {resources.length === 0 ? (
          <section
            className="home-empty"
            aria-label={`${resourceName} search results`}
          >
            <h2>
              {query
                ? `No ${resourceName} match “${query.trim()}”`
                : `No ${resourceName} yet`}
            </h2>
            <p>
              {query
                ? 'Try another search.'
                : `Create a ${isExams ? 'new Exam' : 'Question Bank'} from Home.`}
            </p>
          </section>
        ) : (
          <section
            className="collection-grid"
            aria-label={`${resourceName} search results`}
          >
            {isExams
              ? shownExams.map((exam) => (
                  <ExamCard key={exam.id} exam={exam} onOpen={onOpenExam} />
                ))
              : shownBanks.map((bank) => (
                  <QuestionBankCard
                    key={bank.id}
                    bank={bank}
                    onOpen={onOpenBank}
                    onOpenExam={onOpenExam}
                    onDelete={onDeleteBank}
                  />
                ))}
          </section>
        )}
      </main>
      <Footer />
    </div>
  )
}

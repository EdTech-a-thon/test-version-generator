import type { AuthoringState, SavedState } from "./exam-store";
import type { ExamDraft } from "./question-bank";

function withoutQuestionReferences(
  draft: ExamDraft,
  questionIds: ReadonlySet<string>,
): ExamDraft {
  const remaining = draft.questionIds.filter((id) => !questionIds.has(id));
  const columns = Object.fromEntries(
    Object.entries(draft.columns ?? {}).filter(([id]) => !questionIds.has(id)),
  );
  const choiceOrder = Object.fromEntries(
    Object.entries(draft.choiceOrder ?? {}).filter(
      ([id]) => !questionIds.has(id),
    ),
  );
  return {
    ...draft,
    questionIds: remaining,
    ...(draft.columns === undefined ? {} : { columns }),
    ...(draft.choiceOrder === undefined ? {} : { choiceOrder }),
  };
}

function sameExamDraft(left: ExamDraft, right: ExamDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Remove canonical Questions and their presentation state from one Exam.
 * Deletion is forced external reconciliation, not an Exam edit: saved and
 * Working Copy are transformed together and existing unrelated differences
 * are retained. */
export function withoutQuestions(
  working: AuthoringState,
  saved: SavedState | null,
  questionIds: ReadonlySet<string>,
): { working: AuthoringState; saved: SavedState | null } {
  const nextWorkingDraft = withoutQuestionReferences(
    working.examDraft,
    questionIds,
  );
  const nextSaved = saved
    ? {
        ...saved,
        questionBank: {
          questions: saved.questionBank.questions.filter(
            ({ id }) => !questionIds.has(id),
          ),
        },
        examDraft: withoutQuestionReferences(saved.examDraft, questionIds),
      }
    : null;
  const nextWorking: AuthoringState = {
    ...working,
    questionBank: {
      questions: working.questionBank.questions.filter(
        ({ id }) => !questionIds.has(id),
      ),
    },
    examDraft: nextWorkingDraft,
    dirty: nextSaved
      ? !sameExamDraft(nextWorkingDraft, nextSaved.examDraft)
      : working.dirty,
  };
  return { working: nextWorking, saved: nextSaved };
}

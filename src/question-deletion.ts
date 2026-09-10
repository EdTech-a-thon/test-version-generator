import type { AuthoringState, SavedState } from "./exam-store";
import type { ExamWorkingCopy } from "./question-bank";

function withoutQuestionReferences(
  draft: ExamWorkingCopy,
  questionIds: ReadonlySet<string>,
): ExamWorkingCopy {
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

function sameExamWorkingCopy(left: ExamWorkingCopy, right: ExamWorkingCopy): boolean {
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
    working.workingCopy,
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
        workingCopy: withoutQuestionReferences(saved.workingCopy, questionIds),
      }
    : null;
  const nextWorking: AuthoringState = {
    ...working,
    questionBank: {
      questions: working.questionBank.questions.filter(
        ({ id }) => !questionIds.has(id),
      ),
    },
    workingCopy: nextWorkingDraft,
    dirty: nextSaved
      ? !sameExamWorkingCopy(nextWorkingDraft, nextSaved.workingCopy)
      : working.dirty,
  };
  return { working: nextWorking, saved: nextSaved };
}

import { expect, test } from "bun:test";
import { createQuestion } from "./exam";
import type { AuthoringState, SavedState } from "./exam-store";
import { withoutQuestions } from "./question-deletion";

function state(questionIds: string[], dirty: boolean): AuthoringState {
  const questions = ["a", "b", "c"].map((id) => ({
    ...createQuestion("open"),
    id,
  }));
  return {
    questionBank: { questions },
    examDraft: {
      title: "Biology",
      questionIds,
      columns: { a: 2, b: 4, c: 1 },
      choiceOrder: { a: ["a-1"], b: ["b-1"], c: ["c-1"] },
    },
    dirty,
  };
}

test("forced deletion removes canonical and presentation state while preserving unrelated Working Copy changes", () => {
  const working = state(["c", "a"], true);
  const saved: SavedState = state(["a", "b"], false);

  const deleted = withoutQuestions(working, saved, new Set(["a", "b"]));

  expect(deleted.working.questionBank.questions.map(({ id }) => id)).toEqual([
    "c",
  ]);
  expect(deleted.working.examDraft).toEqual({
    title: "Biology",
    questionIds: ["c"],
    columns: { c: 1 },
    choiceOrder: { c: ["c-1"] },
  });
  expect(deleted.saved?.examDraft.questionIds).toEqual([]);
  expect(deleted.working.dirty).toBe(true);
});

test("forced deletion itself is not an unsaved Exam change", () => {
  const working = state(["a"], false);
  const saved: SavedState = state(["a"], false);

  const deleted = withoutQuestions(working, saved, new Set(["a"]));

  expect(deleted.working.dirty).toBe(false);
  expect(deleted.saved?.examDraft.questionIds).toEqual([]);
});

test("an aborted durable deletion leaves visible store state and history unchanged", () => {
  const before = state(["a", "b"], true);
  // The pure deletion result is prepared for persistence, but the mounted store
  // must not accept it until the cross-resource commit succeeds.
  const prepared = withoutQuestions(
    before,
    state(["a"], false),
    new Set(["a"]),
  );
  expect(prepared.working).not.toBe(before);
  expect(before.questionBank.questions.map(({ id }) => id)).toEqual([
    "a",
    "b",
    "c",
  ]);
  expect(before.examDraft.questionIds).toEqual(["a", "b"]);
  expect(before.dirty).toBe(true);
});

test("forced deletion can resolve a deletion-only Working Copy difference", () => {
  const working = state([], true);
  const saved: SavedState = state(["a"], false);

  const deleted = withoutQuestions(working, saved, new Set(["a"]));

  expect(deleted.working.dirty).toBe(false);
});

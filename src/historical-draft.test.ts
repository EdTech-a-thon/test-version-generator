import { describe, expect, test } from "bun:test";
import { createQuestion, type Question } from "./exam";
import {
  DEFAULT_EXPORT_CONFIGURATION,
  EMPTY_PUBLICATION_HISTORY,
  prepareExport,
  type PublicationHistory,
} from "./export-preparation";
import {
  compatibleHistoricalDraft,
  draftMatchesHistoricalVersion,
} from "./historical-draft";
import {
  createExamDraft,
  type ExamDraft,
  type QuestionBank,
} from "./question-bank";
import { unmeasured } from "./export-plan";

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function question(): Question {
  return {
    ...createQuestion("multiple-choice"),
    id: "question-1",
    doc: {
      type: "doc",
      content: [
        paragraph("Which is correct?"),
        {
          type: "multipleChoice",
          content: [
            {
              type: "multipleChoiceChoice",
              attrs: { id: "a", correct: true },
              content: [paragraph("A")],
            },
            {
              type: "multipleChoiceChoice",
              attrs: { id: "b", correct: false },
              content: [paragraph("B")],
            },
          ],
        },
      ],
    },
  };
}

function published(source: Question): PublicationHistory {
  const first = prepareExport({
    exam: { title: "Quiz", questions: [source] },
    version: {
      id: "exam-draft",
      letter: "A",
      questionOrder: [source.id],
      choiceOrder: { [source.id]: ["b", "a"] },
    },
    configuration: DEFAULT_EXPORT_CONFIGURATION,
    history: EMPTY_PUBLICATION_HISTORY,
    measure: unmeasured,
    createdAt: "2026-09-04T12:00:00.000Z",
  });
  return {
    versions: [first.resolution.version],
    revisions: first.publication.revisions,
    plans: first.publication.plans,
  };
}

describe("compatible historical drafts", () => {
  test("uses current records with the historical question and answer arrangement", () => {
    const source = question();
    const history = published(source);
    const current: QuestionBank = { questions: [source] };
    const draft = createExamDraft("Quiz");
    const replacement = compatibleHistoricalDraft(
      history,
      history.versions[0]!,
      draft,
      current,
    );

    expect(replacement).toEqual({
      title: "Quiz",
      questionIds: ["question-1"],
      choiceOrder: { "question-1": ["b", "a"] },
    });
    expect(
      draftMatchesHistoricalVersion(
        history,
        history.versions[0]!,
        replacement!,
        current,
      ),
    ).toBe(true);
  });

  test("treats a title-only edit as different from its last exported Version", () => {
    const source = question();
    const history = published(source);
    const current: QuestionBank = { questions: [source] };
    const draft = {
      ...createExamDraft("Renamed live draft"),
      questionIds: [source.id],
      choiceOrder: { [source.id]: ["b", "a"] },
    };

    expect(
      draftMatchesHistoricalVersion(
        history,
        history.versions[0]!,
        draft,
        current,
      ),
    ).toBe(false);
  });

  test("restores historical answer content when regenerated choice ids are swapped", () => {
    const source = question();
    const history = published(source);
    const current = {
      ...source,
      doc: {
        ...source.doc,
        content: source.doc.content.map((node) =>
          node.type !== "multipleChoice"
            ? node
            : {
                ...node,
                content: node.content?.map((choice) => ({
                  ...choice,
                  attrs: {
                    ...(choice.attrs as Record<string, unknown>),
                    id: choice.attrs?.id === "a" ? "b" : "a",
                  },
                })),
              },
        ),
      },
    };

    expect(
      compatibleHistoricalDraft(
        history,
        history.versions[0]!,
        createExamDraft(),
        { questions: [current] },
      ),
    ).toMatchObject({ choiceOrder: { "question-1": ["a", "b"] } });
  });

  test("ignores metadata-only changes", () => {
    const source = question();
    const history = published(source);
    const current = {
      ...source,
      difficulty: "hard" as const,
      topics: ["Changed topic"],
    };

    expect(
      compatibleHistoricalDraft(
        history,
        history.versions[0]!,
        createExamDraft(),
        { questions: [current] },
      ),
    ).not.toBeNull();
  });

  test("rejects a Version whose historical answer arrangement cannot map to the current record", () => {
    const source = question();
    const history = published(source);
    const current = {
      ...source,
      doc: {
        ...source.doc,
        content: source.doc.content.map((node) =>
          node.type !== "multipleChoice"
            ? node
            : {
                ...node,
                content: [...(node.content ?? [])].reverse(),
              },
        ),
      },
    };

    expect(
      compatibleHistoricalDraft(
        history,
        history.versions[0]!,
        createExamDraft(),
        { questions: [current] },
      ),
    ).toBeNull();
  });

  test("refuses changed presentation state and preserves the supplied draft", () => {
    const source = question();
    const history = published(source);
    const changed = {
      ...source,
      doc: { ...source.doc, content: [paragraph("Changed wording")] },
    };
    const draft: ExamDraft = {
      title: "Keep me",
      questionIds: [],
      choiceOrder: {},
    };

    expect(
      compatibleHistoricalDraft(history, history.versions[0]!, draft, {
        questions: [changed],
      }),
    ).toBeNull();
    expect(draft).toEqual({
      title: "Keep me",
      questionIds: [],
      choiceOrder: {},
    });
  });
});

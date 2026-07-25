import { describe, expect, it, beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { saveQuestion } from "@/lib/questions";
import { db } from "@/lib/db";
import { assembleForms } from "@/lib/assembly";
import { generateVariants } from "@/lib/parametric";
import type { AssemblyItem } from "@/lib/assembly";
import type { QuestionDraft } from "@/lib/app-types";

const orgId = "test-org-integration";
const userId = "test-user";
const tenant = { orgId, userId, role: "OWNER" as const };

beforeAll(async () => {
  await db.$queryRawUnsafe("PRAGMA foreign_keys=ON");
  await db.org.upsert({ where: { id: orgId }, create: { id: orgId, name: "Test Org", slug: "test-org-integration" }, update: {} });
  await db.user.upsert({ where: { email: "test@integration.local" }, create: { id: userId, email: "test@integration.local", passwordHash: "test" }, update: {} });
  await db.membership.upsert({ where: { orgId_userId: { orgId, userId } }, create: { orgId, userId, role: "OWNER" }, update: { role: "OWNER" } });
});

describe("question editing", () => {
  it("saves then re-saves a question with the same ID", async () => {
    const bank = await db.bank.create({ data: { orgId, name: `Edit test bank ${Date.now()}` } });

    const firstId = await saveQuestion(tenant, {
      bankIds: [bank.id],
      type: "MULTIPLE_CHOICE",
      stem: "Original stem",
      options: [{ id: "A", text: "One" }, { id: "B", text: "Two" }],
      correctAnswer: ["A"],
      difficulty: 2,
      points: 2,
      tags: [],
    });

    const updatedId = await saveQuestion(tenant, {
      id: firstId,
      bankIds: [bank.id],
      type: "MULTIPLE_CHOICE",
      stem: "Edited stem",
      options: [{ id: "A", text: "Three" }, { id: "B", text: "Four" }],
      correctAnswer: ["B"],
      difficulty: 3,
      points: 3,
      tags: ["edited"],
    });

    expect(updatedId).toBe(firstId);

    const saved = await db.question.findUniqueOrThrow({ where: { id: firstId }, include: { versions: { orderBy: { version: "desc" }, take: 1 }, tags: true } });
    expect(saved.stem).toBe("Edited stem");
    expect(saved.difficulty).toBe(3);
    expect(saved.tags[0].name).toBe("edited");
    expect(saved.versions).toHaveLength(1);
    expect(saved.versions[0].version).toBe(2);
    expect(saved.currentVersionId).toBe(saved.versions[0].id);
  });
});

describe("parameteric answer choices in tests", () => {
  it("generates correctLetters for parameteric questions in assembed forms", async () => {
    const definition = {
      variables: [{ name: "x", type: "decimal" as const, min: 1, max: 4 }],
      constraints: [],
      answerFormula: "x * 2",
      distractors: ["x + 1", "x * 3", "x"],
      rounding: { mode: "decimals" as const, value: 1 },
    };

    const result = await generateVariants(definition, 2);
    expect(result.variants).toHaveLength(2);
    const variant = result.variants[0];
    expect(new Set(variant.options).size).toBe(4);

    const fakeItems: AssemblyItem[] = [
      {
        id: "q1",
        difficulty: 3,
        points: 1,
        options: variant.options.map((v) => String(v)),
        correctIndexes: [variant.options.indexOf(variant.correct)],
      },
    ];

    const assembled = assembleForms(fakeItems, 2, false, 3);
    expect(assembled.forms).toHaveLength(2);
    for (const form of assembled.forms) {
      expect(form.items[0].correctLetters.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("decimal variable types", () => {
  it("generates decimal values with precision", async () => {
    const definition = {
      variables: [{ name: "r", type: "decimal" as const, min: 0.1, max: 0.9 }],
      constraints: [],
      answerFormula: "r * r",
      distractors: ["r", "r + 1", "r * 0.1"],
      rounding: { mode: "decimals" as const, value: 2 },
    };

    const result = await generateVariants(definition, 10);
    expect(result.variants.length).toBeGreaterThanOrEqual(1);
    for (const variant of result.variants) {
      expect(typeof variant.variables.r).toBe("number");
      expect(variant.variables.r as number).toBeGreaterThanOrEqual(0.1);
      expect(variant.variables.r as number).toBeLessThanOrEqual(0.9);
      const parts = String(variant.correct).split(".");
      expect(parts.length).toBeLessThanOrEqual(2);
      if (parts.length === 2) expect(parts[1].length).toBeLessThanOrEqual(2);
    }
  });

  it("generates integers when type is integer", async () => {
    const definition = {
      variables: [{ name: "n", type: "integer" as const, min: 1, max: 10 }],
      constraints: [],
      answerFormula: "n * n",
      distractors: ["n", "n + 10", "n * 3"],
      rounding: { mode: "decimals" as const, value: 0 },
    };

    const result = await generateVariants(definition, 5);
    expect(result.variants.length).toBeGreaterThanOrEqual(1);
    for (const variant of result.variants) {
      expect(Number.isInteger(variant.variables.n)).toBe(true);
      expect(Number.isInteger(variant.correct)).toBe(true);
    }
  });
});

describe("manual question selection in test generation", () => {
  it("assembles forms from exact question IDs", async () => {
    const bank = await db.bank.create({ data: { orgId, name: `Manual test bank ${Date.now()}` } });

    const draft: QuestionDraft = {
      bankIds: [bank.id],
      type: "MULTIPLE_CHOICE",
      stem: "Q1",
      options: [{ id: "A", text: "Yes" }, { id: "B", text: "No" }],
      correctAnswer: ["A"],
      difficulty: 2,
      points: 1,
      tags: [],
    };
    const q1Id = await saveQuestion(tenant, draft);
    draft.stem = "Q2";
    draft.options = [{ id: "A", text: "True" }, { id: "B", text: "False" }];
    draft.correctAnswer = ["B"];
    const q2Id = await saveQuestion(tenant, draft);

    const questions = await db.question.findMany({
      where: { orgId, id: { in: [q1Id, q2Id] }, status: "ACTIVE", banks: { some: { bankId: bank.id } } },
      include: { currentVersion: true },
    });
    expect(questions).toHaveLength(2);

    const items: AssemblyItem[] = questions.map((q) => {
      const opts = ((q.content as { options?: Array<{ id: string; text: string }> })?.options ?? []);
      const correct = Array.isArray(q.correctAnswer) ? q.correctAnswer.filter((a): a is string => typeof a === "string") : [];
      return {
        id: q.id,
        difficulty: q.difficulty,
        points: Number((q.content as { points?: number } | null)?.points ?? 1),
        options: opts.map((o) => o.text),
        correctIndexes: correct.map((a) => opts.findIndex((o) => o.id === a)).filter((i) => i >= 0),
      };
    });

    const assembled = assembleForms(items, 3, false, 2);
    expect(assembled.forms).toHaveLength(3);
    for (const form of assembled.forms) {
      expect(form.items).toHaveLength(2);
      const stems = form.items.map((i) => items.find((it) => it.id === i.id)?.options[0]);
      expect(new Set(stems).size).toBeGreaterThanOrEqual(1);
    }
  });
});
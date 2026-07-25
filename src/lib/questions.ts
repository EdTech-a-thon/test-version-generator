import { Prisma } from "@prisma/client";
import type { QuestionDraft } from "@/lib/app-types";
import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/tenant";

function snapshot(draft: QuestionDraft): Prisma.InputJsonValue {
  return {
    type: draft.type,
    stem: draft.stem,
    stemImageKey: (draft as Record<string, unknown>).stemImageKey ?? null,
    options: draft.options,
    correctAnswer: draft.correctAnswer,
    difficulty: draft.difficulty,
    points: draft.points,
    tags: draft.tags,
    solution: draft.solution ?? "",
    rubric: draft.rubric ?? "",
    parametric: draft.parametric ?? null,
  };
}

function activeQuestionData(draft: QuestionDraft) {
  return {
    type: draft.type,
    difficulty: draft.difficulty,
    stem: draft.stem,
    status: "ACTIVE",
    content: { options: draft.options, points: draft.points, parametric: draft.parametric ?? null } as Prisma.InputJsonValue,
    correctAnswer: draft.correctAnswer as Prisma.InputJsonValue,
    solution: draft.solution ? { text: draft.solution } : Prisma.JsonNull,
    rubric: draft.rubric ? { text: draft.rubric } : Prisma.JsonNull,
  };
}

export async function saveQuestion(tenant: TenantContext, draft: QuestionDraft) {
  if (!draft.stem.trim()) throw new Error("A question stem is required.");
  if (draft.difficulty < 1 || draft.difficulty > 5) throw new Error("Difficulty must be from 1 to 5.");
  if (!draft.bankIds.length) throw new Error("Choose at least one bank.");
  const banks = await db.bank.count({ where: { orgId: tenant.orgId, id: { in: draft.bankIds } } });
  if (banks !== draft.bankIds.length) throw new Error("One or more selected banks are not available.");
  return db.$transaction(async (tx) => {
    const question = draft.id
      ? await tx.question.findFirstOrThrow({ where: { id: draft.id, orgId: tenant.orgId } })
      : await tx.question.create({ data: { orgId: tenant.orgId, createdById: tenant.userId, type: draft.type, difficulty: draft.difficulty, stem: draft.stem } });
    const latest = await tx.questionVersion.findFirst({ where: { questionId: question.id, orgId: tenant.orgId }, orderBy: { version: "desc" } });
    const version = await tx.questionVersion.create({
      data: { orgId: tenant.orgId, questionId: question.id, createdById: tenant.userId, version: (latest?.version ?? 0) + 1, snapshot: snapshot(draft) },
    });
    await tx.question.update({
      where: { id: question.id },
      data: {
        ...activeQuestionData(draft),
        currentVersionId: version.id,
        banks: { deleteMany: {}, create: draft.bankIds.map((bankId) => ({ orgId: tenant.orgId, bankId })) },
        tags: { deleteMany: {}, create: draft.tags.filter(Boolean).map((name) => ({ orgId: tenant.orgId, name: name.trim().toLowerCase() })) },
      },
    });
    return question.id;
  });
}

export async function restoreQuestionVersion(tenant: TenantContext, questionId: string, versionId: string) {
  return db.$transaction(async (tx) => {
    const source = await tx.questionVersion.findFirstOrThrow({ where: { id: versionId, questionId, orgId: tenant.orgId } });
    const latest = await tx.questionVersion.findFirst({ where: { questionId, orgId: tenant.orgId }, orderBy: { version: "desc" } });
    const restored = await tx.questionVersion.create({
      data: { orgId: tenant.orgId, questionId, createdById: tenant.userId, version: (latest?.version ?? 0) + 1, snapshot: source.snapshot ?? Prisma.JsonNull, restoredFromVersionId: source.id, restoreReason: `Restored version ${source.version}` },
    });
    const restoredDraft = source.snapshot as unknown as QuestionDraft;
    await tx.question.updateMany({ where: { id: questionId, orgId: tenant.orgId }, data: { ...activeQuestionData(restoredDraft), currentVersionId: restored.id } });
    return restored;
  });
}

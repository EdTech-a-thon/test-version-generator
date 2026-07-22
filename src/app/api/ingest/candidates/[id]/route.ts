import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { saveQuestion } from "@/lib/questions";
import { requireTenantRole } from "@/lib/tenant";

const decision = z.object({ action: z.enum(["APPROVE", "REJECT"]), bankId: z.string().optional(), stem: z.string().trim().min(1).optional(), options: z.array(z.object({ id: z.string().min(1), text: z.string().trim().min(1) })).min(2).max(5).optional(), correctAnswer: z.array(z.string()).optional(), difficulty: z.number().int().min(1).max(5).optional(), tags: z.array(z.string()).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenant = await requireTenantRole(["OWNER", "ADMIN", "EDITOR"]);
    const input = decision.parse(await request.json());
    const { id } = await params;
    const candidate = await db.ingestCandidate.findFirstOrThrow({ where: { id, orgId: tenant.orgId } });
    if (input.action === "REJECT") {
      await db.ingestCandidate.update({ where: { id: candidate.id }, data: { status: "REJECTED" } });
      return NextResponse.json({ status: "REJECTED" });
    }
    if (!input.bankId) throw new Error("Choose a bank before approving this item.");
    const data = candidate.proposedData as { options?: Array<{ id: string; text: string }>; correctAnswer?: string[]; tags?: string[]; difficulty?: number };
    const options = input.options ?? data.options ?? [];
    const correctAnswer = input.correctAnswer ?? data.correctAnswer ?? [];
    if (options.length < 2) throw new Error("Add at least two answer choices before approving this item.");
    if (correctAnswer.length !== 1 || !options.some((option) => option.id === correctAnswer[0])) throw new Error("Choose one correct answer before approving this item.");
    const questionId = await saveQuestion(tenant, { bankIds: [input.bankId], type: candidate.type as "MULTIPLE_CHOICE", stem: input.stem ?? candidate.stem, options, correctAnswer, difficulty: input.difficulty ?? data.difficulty ?? 3, points: 1, tags: input.tags ?? data.tags ?? [] });
    await db.ingestCandidate.update({ where: { id: candidate.id }, data: { status: "APPROVED", promotedQuestionId: questionId } });
    return NextResponse.json({ status: "APPROVED", questionId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not review candidate." }, { status: 400 });
  }
}

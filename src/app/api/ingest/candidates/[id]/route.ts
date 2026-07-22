import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { saveQuestion } from "@/lib/questions";
import { requireTenantRole } from "@/lib/tenant";

const decision = z.object({ action: z.enum(["APPROVE", "REJECT"]), bankId: z.string().optional(), difficulty: z.number().int().min(1).max(5).optional(), tags: z.array(z.string()).optional() });

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
    const questionId = await saveQuestion(tenant, { bankIds: [input.bankId], type: candidate.type as "MULTIPLE_CHOICE", stem: candidate.stem, options: data.options ?? [], correctAnswer: data.correctAnswer ?? [], difficulty: input.difficulty ?? data.difficulty ?? 3, points: 1, tags: input.tags ?? data.tags ?? [] });
    await db.ingestCandidate.update({ where: { id: candidate.id }, data: { status: "APPROVED", promotedQuestionId: questionId } });
    return NextResponse.json({ status: "APPROVED", questionId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not review candidate." }, { status: 400 });
  }
}

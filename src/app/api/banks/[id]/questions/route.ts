import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTenant, requireTenantRole } from "@/lib/tenant";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenant = await requireTenant();
    const { id } = await params;
    const bank = await db.bank.findFirst({
      where: { id, orgId: tenant.orgId, status: "ACTIVE" },
      include: { questions: { where: { question: { status: "ACTIVE" } }, include: { question: { include: { tags: true, currentVersion: true } } }, orderBy: { question: { updatedAt: "desc" } } } },
    });
    if (!bank) return NextResponse.json({ error: "Question bank not found." }, { status: 404 });
    return NextResponse.json({ id: bank.id, name: bank.name, description: bank.description, questions: bank.questions.map(({ question }) => ({ id: question.id, stem: question.stem, difficulty: question.difficulty, tags: question.tags.map((tag) => tag.name), stemImageKey: ((question.currentVersion?.snapshot as Record<string, unknown> | null)?.stemImageKey as string | null) ?? null })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load this question bank." }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tenant = await requireTenantRole(["OWNER", "ADMIN", "EDITOR"]);
    const { id } = await params;
    const questionId = new URL(request.url).searchParams.get("questionId");
    if (!questionId) throw new Error("Choose a question to remove.");
    await db.bankQuestion.deleteMany({ where: { orgId: tenant.orgId, bankId: id, questionId } });
    return NextResponse.json({ status: "REMOVED" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove the question from this bank." }, { status: 400 });
  }
}

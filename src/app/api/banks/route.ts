import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireTenant, requireTenantRole } from "@/lib/tenant";

const bankSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
});

export async function GET() {
  try {
    const tenant = await requireTenant();
    const banks = await db.bank.findMany({
      where: { orgId: tenant.orgId, status: "ACTIVE" },
      include: {
        _count: { select: { questions: true } },
        questions: {
          where: { question: { status: "ACTIVE" } },
          select: { question: { select: { difficulty: true, tags: { select: { name: true } } } } },
        },
      },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(banks.map((bank) => ({
      id: bank.id,
      name: bank.name,
      questionCount: bank.questions.length,
      questions: bank.questions.map(({ question }) => ({ difficulty: question.difficulty, tags: question.tags.map((tag) => tag.name) })),
    })));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load banks." }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const tenant = await requireTenantRole(["OWNER", "ADMIN", "EDITOR"]);
    const data = bankSchema.parse(await request.json());
    const bank = await db.bank.create({ data: { ...data, orgId: tenant.orgId } });
    return NextResponse.json(bank, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create bank." }, { status: 400 });
  }
}

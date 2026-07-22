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
      include: { _count: { select: { questions: true } } },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(banks);
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

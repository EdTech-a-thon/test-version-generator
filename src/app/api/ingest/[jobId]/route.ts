import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";

export async function GET(_: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const tenant = await requireTenant();
    const { jobId } = await params;
    const job = await db.ingestJob.findFirst({ where: { id: jobId, orgId: tenant.orgId }, include: { candidates: { orderBy: { createdAt: "asc" } }, media: true } });
    if (!job) return NextResponse.json({ error: "Review job not found." }, { status: 404 });
    return NextResponse.json(job);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load review job." }, { status: 400 });
  }
}

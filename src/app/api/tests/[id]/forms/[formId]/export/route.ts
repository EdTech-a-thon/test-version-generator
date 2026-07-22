import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { genericCsvKeyAdapter } from "@/lib/export";
import { requireTenant } from "@/lib/tenant";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; formId: string }> }) {
  try {
    const tenant = await requireTenant();
    const { id, formId } = await params;
    const form = await db.form.findFirst({ where: { id: formId, testId: id, orgId: tenant.orgId }, include: { items: { orderBy: { position: "asc" } } } });
    if (!form) return NextResponse.json({ error: "Form not found." }, { status: 404 });
    const bubbled = form.items.filter((item) => {
      const rendered = item.generatedParams as { options?: unknown[] } | null;
      return (rendered?.options?.length ?? 0) > 0;
    });
    if (!bubbled.length) return NextResponse.json({ error: "This form has no bubbled questions to export." }, { status: 422 });
    const csv = genericCsvKeyAdapter.format({ id: form.id, formCode: form.code, items: bubbled.map((item, index) => ({ position: index + 1, correctLetters: Array.isArray(item.correctLetters) ? item.correctLetters.filter((value): value is string => typeof value === "string") : [], points: item.points })) });
    return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="form-${form.code}-key.csv"` } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not export key." }, { status: 400 });
  }
}

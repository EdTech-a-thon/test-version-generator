import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { FormContent } from "@/app/tests/[id]/page";
import { PrintButton } from "@/components/print-button";

export default async function PrintableFormPage({ params }: { params: Promise<{ id: string; formId: string }> }) {
  const tenant = await requireTenant(); const { id, formId } = await params;
  const form = await db.form.findFirst({ where: { id: formId, testId: id, orgId: tenant.orgId }, include: { test: true, items: { orderBy: { position: "asc" } } } });
  if (!form) notFound();
  return <main className="print-workspace"><nav className="print-controls" aria-label="Printable form actions"><Link href={`/tests/${id}`}>Back to all forms</Link><a href={`/api/tests/${id}/forms/${form.id}/export`}>Download CSV answer key</a><PrintButton /></nav><p className="print-guidance">Print includes the student form followed by its matching answer key. Confirm the form ID before handing it out.</p><FormContent form={form} title={form.test.title} /><FormContent form={form} title={form.test.title} answerKey /></main>;
}

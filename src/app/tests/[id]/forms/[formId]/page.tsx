import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { FormContent } from "@/components/form-content";
import { PrintButton } from "@/components/print-button";

export default async function PrintableFormPage({ params }: { params: Promise<{ id: string; formId: string }> }) {
  const tenant = await requireTenant(); const { id, formId } = await params;
  const form = await db.form.findFirst({ where: { id: formId, testId: id, orgId: tenant.orgId }, include: { test: true, items: { orderBy: { position: "asc" } } } });
  if (!form) notFound();
  const hasBubbledQuestions = form.items.some((item) => {
    const rendered = item.generatedParams as { options?: unknown[] } | null;
    return (rendered?.options?.length ?? 0) > 0;
  });
  return <main className="print-workspace"><nav className="print-controls" aria-label="Printable form actions"><Link href={`/tests/${id}`}>Back to all forms</Link>{hasBubbledQuestions && <a href={`/api/tests/${id}/forms/${form.id}/export`}>Download CSV answer key</a>}<PrintButton /></nav><p className="print-guidance"><strong>Before handing this out:</strong> this page prints the student form first and Form {form.code}&rsquo;s matching answer key second. Check the form ID on both pages. {hasBubbledQuestions ? "The CSV key includes bubbled questions only." : "This form has written responses only, so there is no CSV answer key."}</p><FormContent form={form} title={form.test.title} /><FormContent form={form} title={form.test.title} answerKey /></main>;
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { AppHeader } from "@/components/app-header";

export default async function TestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ warning?: string }> }) {
  const tenant = await requireTenant();
  const { id } = await params;
  const { warning } = await searchParams;
  const test = await db.test.findFirst({ where: { id, orgId: tenant.orgId }, include: { forms: { include: { _count: { select: { items: true } }, items: { take: 1, select: { generatedParams: true } } }, orderBy: { code: "asc" } } } });
  if (!test) notFound();
  return <main><AppHeader current="Your generated test" /><section className="workspace"><p className="eyebrow">Ready to review</p><h1>{test.title}</h1><p className="lead">Open each form, check the form ID and answer key, then print the student version with its matching key.</p>{warning && <p className="notice" role="status"><strong>Check before printing:</strong> {warning}</p>}<p className="collection-summary">{test.forms.length} form{test.forms.length === 1 ? "" : "s"} generated. These are frozen, so later question edits will not change anything you print.</p><section className="bank-list">{test.forms.map((form) => { const firstItem = form.items[0]; const hasBubbled = firstItem ? ((firstItem.generatedParams as { options?: unknown[] } | null)?.options?.length ?? 0) > 0 : false; return <article className="card" key={form.id}><p className="eyebrow">Form {form.code}</p><h2>Review before printing</h2><p>{form._count.items} questions, a matching answer key, and {hasBubbled ? "a CSV key for its bubbled questions." : "no CSV key because it has written responses only."}</p><Link className="primary" href={`/tests/${test.id}/forms/${form.id}`}>Review Form {form.code}</Link></article>; })}</section><Link className="quiet-link" href="/tests/new">Create another test</Link></section></main>;
}
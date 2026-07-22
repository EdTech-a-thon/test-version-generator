import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { letter } from "@/lib/format";
import { requireTenant } from "@/lib/tenant";
import type { RenderedFormItem } from "@/lib/contracts";
import { AppHeader } from "@/components/app-header";

type PrintableItem = {
  position: number;
  points: number;
  correctLetters: unknown;
  choiceOrder: unknown;
  generatedParams: unknown;
};

export default async function TestPage({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await requireTenant();
  const { id } = await params;
  const test = await db.test.findFirst({ where: { id, orgId: tenant.orgId }, include: { forms: { include: { items: true }, orderBy: { code: "asc" } } } });
  if (!test) notFound();
  return <main><AppHeader current="Your generated test" /><section className="workspace"><p className="eyebrow">Ready to print</p><h1>{test.title}</h1><p className="lead">Your forms are ready. Open each one to print the student version, its answer key, and a CSV key if you use a compatible grading tool.</p><p className="collection-summary">{test.forms.length} form{test.forms.length === 1 ? "" : "s"} generated. These are frozen, so later question edits will not change anything you print.</p><section className="bank-list">{test.forms.map((form) => <article className="card" key={form.id}><p className="eyebrow">Student version</p><h2>Form {form.code}</h2><p>{form.items.length} questions with a matching answer key.</p><Link className="primary" href={`/tests/${test.id}/forms/${form.id}`}>Review and print</Link></article>)}</section><Link className="quiet-link" href="/tests/new">Create another test</Link></section></main>;
}

function snapshot(item: PrintableItem): RenderedFormItem {
  return item.generatedParams as RenderedFormItem;
}

export function FormContent({ form, title, answerKey = false }: { form: { code: string; items: PrintableItem[] }; title: string; answerKey?: boolean }) {
  const bubbled = form.items.filter((item) => snapshot(item).options.length > 0);
  const freeResponse = form.items.filter((item) => snapshot(item).options.length === 0);
  const bubblePoints = bubbled.reduce((total, item) => total + item.points, 0);
  const responsePoints = freeResponse.reduce((total, item) => total + item.points, 0);
  return <article className="print-page"><header className="print-header"><strong>{title}{answerKey ? " Answer Key" : ""}</strong><span>Form ID: {form.code}</span></header>{bubbled.length > 0 && <section><h2 className="section-label">Bubble section</h2>{bubbled.map((item, index) => <BubbledItem item={item} number={index + 1} answerKey={answerKey} key={item.position} />)}</section>}{freeResponse.length > 0 && <section><h2 className="section-label">Written response</h2>{freeResponse.map((item, index) => <FreeResponseItem item={item} number={index + 1} answerKey={answerKey} key={item.position} />)}</section>}{answerKey && <p className="key-note">Bubbled subtotal: {bubblePoints} points. Written-response subtotal: {responsePoints} points. Total: {bubblePoints + responsePoints} points.</p>}<footer>Test Generator | Form ID: {form.code}</footer></article>;
}

function BubbledItem({ item, number, answerKey }: { item: PrintableItem; number: number; answerKey: boolean }) {
  const data = snapshot(item);
  const order = Array.isArray(item.choiceOrder) ? item.choiceOrder.filter((index): index is number => typeof index === "number") : data.options.map((_, index) => index);
  const correctLetters = Array.isArray(item.correctLetters) ? item.correctLetters.filter((value): value is string => typeof value === "string") : [];
  return <section className="print-question"><h3>{number}. {data.stem}</h3><ol>{order.map((optionIndex, index) => <li className={answerKey && correctLetters.includes(letter(index)) ? "correct-choice" : ""} key={`${item.position}-${optionIndex}`}><span className="bubble">{letter(index)}</span>{data.options[optionIndex]?.text}{answerKey && correctLetters.includes(letter(index)) ? <strong> Correct</strong> : null}</li>)}</ol>{answerKey ? <p>Answer: {correctLetters.join(", ")}{data.generatedVariant ? ` (${data.generatedVariant.correct})` : ""}</p> : null}</section>;
}

function FreeResponseItem({ item, number, answerKey }: { item: PrintableItem; number: number; answerKey: boolean }) {
  const data = snapshot(item);
  return <section className="print-question free-response"><h3>FR{number}. {data.stem} ({item.points} points)</h3>{answerKey ? <><p><strong>Expected answer:</strong> {data.correctAnswer.join(", ") || "See solution"}</p>{data.solution && <p><strong>Solution:</strong> {data.solution}</p>}{data.rubric && <p><strong>Rubric:</strong> {data.rubric}</p>}</> : <div className="response-space" />}</section>;
}

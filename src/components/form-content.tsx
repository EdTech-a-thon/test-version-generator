import { letter } from "@/lib/format";
import { renderMarkup } from "@/lib/render-markup";
import type { RenderedFormItem } from "@/lib/contracts";

type PrintableItem = { position: number; points: number; correctLetters: unknown; choiceOrder: unknown; generatedParams: unknown };

function snapshot(item: PrintableItem): RenderedFormItem { return item.generatedParams as RenderedFormItem; }

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
  return <section className="print-question"><h3>{number}. {renderMarkup(data.stem)}</h3><ol>{order.map((optionIndex, index) => <li className={answerKey && correctLetters.includes(letter(index)) ? "correct-choice" : ""} key={`${item.position}-${optionIndex}`}><span className="bubble">{letter(index)}</span>{renderMarkup(data.options[optionIndex]?.text)}{answerKey && correctLetters.includes(letter(index)) ? <strong> Correct</strong> : null}</li>)}</ol>{answerKey ? <p>Answer: {correctLetters.join(", ")}{data.generatedVariant ? ` (${data.generatedVariant.correct})` : ""}</p> : null}</section>;
}

function FreeResponseItem({ item, number, answerKey }: { item: PrintableItem; number: number; answerKey: boolean }) {
  const data = snapshot(item);
  return <section className="print-question free-response"><h3>FR{number}. {renderMarkup(data.stem)} ({item.points} points)</h3>{answerKey ? <><p><strong>Expected answer:</strong> {data.correctAnswer.join(", ") || "See solution"}</p>{data.solution && <p><strong>Solution:</strong> {data.solution}</p>}{data.rubric && <p><strong>Rubric:</strong> {data.rubric}</p>}</> : <div className="response-space" />}</section>;
}

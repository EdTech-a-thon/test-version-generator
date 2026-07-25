"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";

type Bank = {
  id: string;
  name: string;
  questionCount: number;
  questions: Array<{ difficulty: number; tags: string[] }>;
};

export default function NewTestPage() {
  const router = useRouter();
  const [forms, setForms] = useState(4);
  const [itemCount, setItemCount] = useState(10);
  const [strict, setStrict] = useState(false);
  const [tag, setTag] = useState("");
  const [difficulty, setDifficulty] = useState(3);
  const [message, setMessage] = useState("");
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankId, setBankId] = useState("");
  const [loadingBanks, setLoadingBanks] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const requestedBank = new URLSearchParams(window.location.search).get("bank");
    void fetch("/api/banks")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load your question banks.");
        setBanks(data);
        setBankId(data.some((bank: Bank) => bank.id === requestedBank) ? requestedBank! : data[0]?.id ?? "");
      })
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setLoadingBanks(false));
  }, []);

  const selectedBank = banks.find((bank) => bank.id === bankId);
  const normalizedTag = tag.trim().toLowerCase();
  const matchingQuestions = selectedBank?.questions.filter((question) => {
    return (!normalizedTag || question.tags.includes(normalizedTag)) && (!strict || question.difficulty === difficulty);
  }).length ?? 0;
  const ready = matchingQuestions >= itemCount;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isGenerating) return;
    if (!Number.isInteger(itemCount) || itemCount < 1) {
      setMessage("Choose at least one question per form.");
      return;
    }
    if (!ready) {
      setMessage(`This selection has ${matchingQuestions} matching question${matchingQuestions === 1 ? "" : "s"}, but each form needs ${itemCount}. Add questions, change the filter, or lower the number per form.`);
      return;
    }

    const values = new FormData(event.currentTarget);
    setIsGenerating(true);
    setMessage("Creating your test forms. This may take a moment for generated questions.");
    try {
      const response = await fetch("/api/tests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: values.get("title"),
          bankId,
          formCount: forms,
          tag,
          itemCount,
          targetDifficulty: difficulty,
          scrambleChoices: values.get("scramble") === "on",
          strictDifficulty: strict,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "We could not create the forms. Check the setup below and try again.");
        return;
      }
      const warning = Array.isArray(data.warnings) && data.warnings.length ? `?warning=${encodeURIComponent(data.warnings.join(" "))}` : "";
      router.push(`/tests/${data.id}${warning}`);
    } catch {
      setMessage("We could not reach the test generator. Your choices are still here, so please try again.");
    } finally {
      setIsGenerating(false);
    }
  }

  return <main><AppHeader current="Create a test" /><section className="workspace"><div className="section-heading"><div><p className="eyebrow">Step 2 of 2</p><h1>Create test forms</h1><p className="lead">Choose what to include. We will check that your bank can support the test before you create it.</p></div><Link className="quiet-link" href={bankId ? `/banks/${bankId}` : "/banks"}>Back to question bank</Link></div>{message && <p className="notice" role="status">{message}</p>}{loadingBanks ? <p className="notice">Loading your question banks...</p> : !banks.length ? <section className="empty"><p className="eyebrow">Start with a bank</p><h2>Create a question bank first</h2><p>Tests are built from one bank, so the questions stay focused on the topic you are assessing.</p><Link className="primary" href="/banks">Create a question bank</Link></section> : <div className="editor-grid"><form className="editor" onSubmit={submit}><label>Question bank<select value={bankId} onChange={(event) => setBankId(event.target.value)} required>{banks.map((bank) => <option value={bank.id} key={bank.id}>{bank.name}</option>)}</select><span className="field-help">{selectedBank?.questionCount ?? 0} active question{selectedBank?.questionCount === 1 ? "" : "s"} available in this bank.</span></label><label>Assessment title<input name="title" defaultValue="Unit assessment" required /></label><label>Questions per form<input type="number" value={itemCount} onChange={(event) => setItemCount(Number(event.target.value))} min="1" max="100" required /></label><label>Forms to generate<input type="number" min="1" max="26" value={forms} onChange={(event) => setForms(Number(event.target.value))} required /><span className="field-help">Use one form when every student should receive the same version.</span></label><label>Optional tag filter<input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="For example: review" /><span className="field-help">Leave blank to use all questions in this bank.</span></label><label>Target difficulty<select value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label className="toggle"><input type="checkbox" name="scramble" defaultChecked />Scramble answer choices within each form</label><label className="toggle"><input type="checkbox" checked={strict} onChange={(event) => setStrict(event.target.checked)} />Use only questions at the target difficulty</label><p className="field-help">When this is off, the target guides the balance. When it is on, every selected question must match that difficulty.</p><button type="submit" disabled={!ready || isGenerating}>{isGenerating ? "Creating forms..." : "Create forms and answer keys"}</button><p className="field-help" style={{marginTop: "12px"}}>Prefer to hand-pick each question? <Link href={bankId ? `/tests/new/pick?bank=${bankId}` : "#"} className="quiet-link">Select questions manually</Link></p></form><aside className="preview"><p className="eyebrow">Readiness check</p><h2>{matchingQuestions} question{matchingQuestions === 1 ? "" : "s"} match your choices</h2><p>{strict ? `Only difficulty ${difficulty} questions are included.` : "All difficulty levels can be used; the target guides the balance."}{normalizedTag ? ` The tag "${tag.trim()}" is applied.` : " No tag filter is applied."}</p>{!ready && <p className="readiness-problem">You need {Math.max(itemCount - matchingQuestions, 0)} more matching question{itemCount - matchingQuestions === 1 ? "" : "s"} to make this test.</p>}<hr /><p className="eyebrow">After creating</p><p>Review each form, confirm its form ID, then print the student version and matching answer key together. You can also download a CSV answer key for bubbled questions.</p></aside></div>}</section></main>;
}

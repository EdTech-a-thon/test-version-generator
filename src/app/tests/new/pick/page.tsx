"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";

type Question = { id: string; stem: string; difficulty: number; tags: string[] };

export default function PickQuestionsPage() {
  const router = useRouter();
  const [bankId, setBankId] = useState("");
  const [bankName, setBankName] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [forms, setForms] = useState(4);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedBank = params.get("bank");
    if (!requestedBank) {
      setMessage("Choose a question bank first.");
      setLoading(false);
      return;
    }
    setBankId(requestedBank);
    void fetch(`/api/banks/${requestedBank}/questions`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load questions.");
        setBankName(data.name);
        setQuestions(data.questions);
      })
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setLoading(false));
  }, []);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() { setSelected(new Set(questions.map((question) => question.id))); }
  function clearAll() { setSelected(new Set()); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isGenerating) return;
    if (selected.size < 1) {
      setMessage("Select at least one question.");
      return;
    }
    const values = new FormData(event.currentTarget);
    setIsGenerating(true);
    setMessage("Creating your test forms. This may take a moment.");
    try {
      const response = await fetch("/api/tests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: values.get("title"),
          bankId,
          formCount: forms,
          itemCount: selected.size,
          scrambleChoices: values.get("scramble") === "on",
          strictDifficulty: false,
          questionIds: [...selected],
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "We could not create the forms. Please try again.");
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

  return <main><AppHeader current="Pick questions" /><section className="workspace"><div className="section-heading"><div><p className="eyebrow">Manual selection</p><h1>Pick your questions</h1><p className="lead">{loading ? "Loading..." : `Choose which questions to include from ${bankName}.`}</p></div><Link className="quiet-link" href={`/tests/new?bank=${bankId}`}>Use automatic selection</Link></div>{message && <p className="notice" role="status">{message}</p>}{loading ? <p className="notice">Loading questions...</p> : questions.length === 0 ? <section className="empty"><h2>No questions in this bank</h2><p>Add questions first, then return to build a test.</p><Link className="primary" href={`/banks/${bankId}`}>Go to question bank</Link></section> : <div className="editor-grid"><form onSubmit={submit}><div className="editor"><label>Assessment title<input name="title" defaultValue="Unit assessment" required /></label><label>Forms to generate<input type="number" min="1" max="26" value={forms} onChange={(event) => setForms(Number(event.target.value))} required /><span className="field-help">Each form will have the same questions in a different order.</span></label><label className="toggle"><input type="checkbox" name="scramble" defaultChecked />Scramble answer choices within each form</label><p className="field-help">You have selected {selected.size} of {questions.length} question{questions.length === 1 ? "" : "s"}.</p><div className="completion-actions"><button type="button" onClick={selectAll}>Select all</button><button type="button" className="secondary" onClick={clearAll}>Clear selection</button></div></div><section className="bank-list" style={{marginTop: "18px"}}>{questions.map((question) => <article className={`card ${selected.has(question.id) ? "card-selected" : ""}`} key={question.id} onClick={() => toggle(question.id)}><div className="card-check"><input type="checkbox" checked={selected.has(question.id)} onChange={() => toggle(question.id)} onClick={(event) => event.stopPropagation()} /></div><div><p className="eyebrow">Difficulty {question.difficulty} of 5</p><h2 style={{fontSize: "20px"}}>{question.stem}</h2><p>{question.tags.length ? question.tags.join(", ") : "No tags"}</p></div></article>)}</section><button type="submit" disabled={selected.size === 0 || isGenerating} style={{marginTop: "18px"}}>{isGenerating ? "Creating forms..." : `Create ${forms} form${forms === 1 ? "" : "s"} from ${selected.size} question${selected.size === 1 ? "" : "s"}`}</button></form></div>}</section></main>;
}
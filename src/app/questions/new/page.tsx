"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { VariantPreview } from "@/components/variant-preview";
import type { ParametricDefinition, VariableDefinition } from "@/lib/contracts";

const blankDefinition: ParametricDefinition = {
  variables: [{ name: "", type: "integer", min: 1, max: 10 }],
  constraints: [],
  answerFormula: "",
  distractors: ["", "", ""],
  rounding: { mode: "decimals", value: 0 },
};

function FormulaEditor({ definition, onChange }: { definition: ParametricDefinition; onChange: (definition: ParametricDefinition) => void }) {
  function updateVariable(index: number, field: keyof VariableDefinition, value: string) {
    onChange({
      ...definition,
      variables: definition.variables.map((variable, current) => current === index
        ? { ...variable, [field]: field === "name" ? value.replace(/[^a-zA-Z0-9_]/g, "") : Number(value) }
        : variable),
    });
  }

  return <section className="formula-editor" aria-labelledby="values-heading">
    <div>
      <p className="eyebrow">Step 2</p>
      <h2 id="values-heading">Set the changing values</h2>
      <p className="helper">Give each value a short name, then use that name in the question, such as <code>{"{{m}}"}</code>.</p>
    </div>
    {definition.variables.filter((value): value is VariableDefinition => value.type !== "dataset").map((variable, index) => <div className="variable-row" key={index}>
      <strong>Value {index + 1}</strong>
      <label>Name<input value={variable.name} required placeholder="m" onChange={(event) => updateVariable(index, "name", event.target.value)} /></label>
      <label>Smallest<input type="number" value={variable.min ?? ""} required onChange={(event) => updateVariable(index, "min", event.target.value)} /></label>
      <label>Largest<input type="number" value={variable.max ?? ""} required onChange={(event) => updateVariable(index, "max", event.target.value)} /></label>
      {definition.variables.length > 1 && <button type="button" className="text-button" onClick={() => onChange({ ...definition, variables: definition.variables.filter((_, current) => current !== index) })}>Remove</button>}
    </div>)}
    {definition.variables.length < 4 && <button type="button" className="secondary add-value" onClick={() => onChange({ ...definition, variables: [...definition.variables, { name: "", type: "integer", min: 1, max: 10 }] })}>Add another value</button>}
    <label>Correct answer calculation<input value={definition.answerFormula} required onChange={(event) => onChange({ ...definition, answerFormula: event.target.value })} placeholder="m * a" /><span className="field-help">Use <code>*</code> to multiply and <code>/</code> to divide.</span></label>
    <fieldset>
      <legend>Likely incorrect calculations</legend>
      <p className="field-help">These become plausible answer choices for students.</p>
      {definition.distractors.map((distractor, index) => <label key={index}>Incorrect calculation {index + 1}<input required value={typeof distractor === "string" ? distractor : ""} onChange={(event) => onChange({ ...definition, distractors: definition.distractors.map((value, current) => current === index ? event.target.value : value) })} placeholder={index === 0 ? "m + a" : undefined} /></label>)}
    </fieldset>
    <div className="two-col">
      <label>Answer unit (optional)<input value={definition.unit ?? ""} onChange={(event) => onChange({ ...definition, unit: event.target.value })} placeholder="N" /></label>
      <label>Decimal places<select value={definition.rounding.value} onChange={(event) => onChange({ ...definition, rounding: { mode: "decimals", value: Number(event.target.value) } })}>{[0, 1, 2, 3].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
    </div>
    <label>Rule (optional)<textarea value={definition.constraints[0] ?? ""} onChange={(event) => onChange({ ...definition, constraints: event.target.value.trim() ? [event.target.value] : [] })} rows={2} placeholder="m != a" /><span className="field-help">Use this only when some combinations should be excluded.</span></label>
  </section>;
}

export default function NewQuestion() {
  const [mode, setMode] = useState<"standard" | "changing">("standard");
  const [definition, setDefinition] = useState(blankDefinition);
  const [previewValid, setPreviewValid] = useState(false);
  const [stem, setStem] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [banks, setBanks] = useState<Array<{ id: string; name: string }>>([]);
  const [bankId, setBankId] = useState("");
  const [loadingBanks, setLoadingBanks] = useState(true);
  const [bankError, setBankError] = useState("");
  const [saved, setSaved] = useState(false);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    const requestedBank = new URLSearchParams(window.location.search).get("bank");
    void fetch("/api/banks").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load your question banks.");
      setBanks(data);
      setBankId(data.some((bank: { id: string }) => bank.id === requestedBank) ? requestedBank! : data[0]?.id ?? "");
    }).catch((error: Error) => setBankError(error.message)).finally(() => setLoadingBanks(false));
  }, []);

  function changeDefinition(next: ParametricDefinition) {
    setDefinition(next);
    setPreviewValid(false);
  }

  function startAnother() {
    setMode("standard");
    setDefinition(blankDefinition);
    setPreviewValid(false);
    setStem("");
    setMessage("");
    setSaved(false);
    setFormKey((current) => current + 1);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "changing" && !previewValid) {
      setMessage("Preview four valid versions before saving.");
      return;
    }
    setSaving(true);
    setMessage("");
    const values = new FormData(event.currentTarget);
    const options = mode === "standard"
      ? ["A", "B", "C", "D"].map((id) => ({ id, text: String(values.get(`option-${id}`) ?? "").trim() })).filter((option) => option.text)
      : [];
    const correct = mode === "standard" ? String(values.get("correct") ?? "") : "";
    try {
      const response = await fetch("/api/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bankIds: [bankId], type: "MULTIPLE_CHOICE", stem, options, correctAnswer: correct ? [correct] : [], difficulty: Number(values.get("difficulty")), points: Number(values.get("points")), tags: String(values.get("tags")).split(",").map((tag) => tag.trim()).filter(Boolean), solution: values.get("solution"), parametric: mode === "changing" ? definition : undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save question.");
      setSaved(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save question. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const selectedBank = banks.find((bank) => bank.id === bankId);
  const canPreview = definition.variables.length > 0 && definition.variables.every((variable) => variable.type !== "dataset" && Boolean(variable.name) && variable.min !== undefined && variable.max !== undefined && variable.min <= variable.max) && Boolean(definition.answerFormula.trim()) && definition.distractors.every((distractor) => typeof distractor !== "string" || distractor.trim()) && Boolean(stem.trim());

  return <main>
    <AppHeader current="Add a question" />
    <section className="workspace author-workspace">
      <div className="author-heading">
        <div><p className="eyebrow">Build your question bank</p><h1>Add a question</h1><p className="lead">Write it once, then reuse it in any test.</p></div>
        <Link className="quiet-link" href={bankId ? `/banks/${bankId}` : "/banks"}>Back to question bank</Link>
      </div>

      {saved ? <section className="save-confirmation" role="status">
        <span className="success-mark" aria-hidden="true">✓</span>
        <p className="eyebrow">Question saved</p>
        <h2>Added to {selectedBank?.name}</h2>
        <p>This question is ready to use when you create a test.</p>
        <div className="completion-actions"><button type="button" onClick={startAnother}>Add another question</button><Link className="secondary" href={`/banks/${bankId}`}>View question bank</Link><Link className="quiet-link" href="/tests/new">Create a test</Link></div>
      </section> : <>
        {loadingBanks && <p className="notice">Loading your question banks...</p>}
        {bankError && <p className="warning">{bankError} <Link href="/login">Sign in</Link> to continue.</p>}
        {!loadingBanks && !bankError && !banks.length && <section className="empty"><h2>Create a question bank first</h2><p>A bank keeps related questions together so you can reuse them.</p><Link className="primary" href="/banks">Create a question bank</Link></section>}
        {banks.length > 0 && <form key={formKey} onSubmit={save} className={`question-flow ${mode === "changing" ? "changing-flow" : ""}`}>
          <section className="flow-card setup-card">
            <p className="eyebrow">Start here</p>
            <div className="bank-context"><span>Adding to</span><label><span className="sr-only">Question bank</span><select value={bankId} onChange={(event) => setBankId(event.target.value)} required>{banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label></div>
            <fieldset className="mode-picker">
              <legend>What kind of question are you adding?</legend>
              <label className={mode === "standard" ? "selected" : ""}><input type="radio" name="mode" checked={mode === "standard"} onChange={() => { setMode("standard"); setMessage(""); }} /><span><strong>Standard multiple choice</strong><small>The same question and choices appear each time.</small></span></label>
              <label className={mode === "changing" ? "selected" : ""}><input type="radio" name="mode" checked={mode === "changing"} onChange={() => { setMode("changing"); setMessage(""); }} /><span><strong>Question with changing values</strong><small>Numbers change automatically to create different versions.</small></span></label>
            </fieldset>
          </section>

          <section className="flow-card question-card">
            <p className="eyebrow">Step 1</p>
            <h2>Write the question</h2>
            <label>Question for students<textarea name="stem" rows={4} value={stem} onChange={(event) => { setStem(event.target.value); setPreviewValid(false); }} required placeholder={mode === "changing" ? "What force is produced by a mass of {{m}} kg accelerating at {{a}} m/s²?" : "What is the main function of a plant's roots?"} />{mode === "changing" && <span className="field-help">Put changing value names inside double curly brackets, such as <code>{"{{m}}"}</code>.</span>}</label>
            {mode === "standard" && <fieldset className="answer-choices"><legend>Answer choices</legend><p className="field-help">Select the circle beside the correct answer. The first two choices are required.</p>{["A", "B", "C", "D"].map((choice, index) => <label className="choice-input" key={choice}><input type="radio" name="correct" value={choice} required aria-label={`Mark choice ${choice} correct`} /><span>{choice}</span><input name={`option-${choice}`} required={index < 2} placeholder={index < 2 ? `Choice ${choice}` : `Choice ${choice} (optional)`} /></label>)}</fieldset>}
          </section>

          {mode === "changing" && <FormulaEditor definition={definition} onChange={changeDefinition} />}
          {mode === "changing" && canPreview && <VariantPreview definition={definition} stem={stem} onValidityChange={setPreviewValid} />}

          <section className="flow-card details-card">
            <p className="eyebrow">{mode === "changing" ? "Step 3" : "Step 2"}</p>
            <h2>Add teaching details</h2>
            <div className="two-col">
              <label>Difficulty<select name="difficulty" defaultValue="3"><option value="1">1 - easiest</option><option value="2">2 - easier</option><option value="3">3 - moderate</option><option value="4">4 - challenging</option><option value="5">5 - most challenging</option></select></label>
              <label>Points<input name="points" defaultValue="1" type="number" min="0.5" step="0.5" required /></label>
            </div>
            <label>Tags (optional)<input name="tags" placeholder="mechanics, forces" /><span className="field-help">Use the same tag later to gather related questions into a test.</span></label>
            <label>Explanation or teacher note (optional)<textarea name="solution" rows={3} /></label>
          </section>

          <footer className="save-bar">
            <div><strong>Save to {selectedBank?.name}</strong><span>{mode === "changing" && !previewValid ? "Preview four versions before saving." : "You can add another question after this one."}</span></div>
            {message && <p className="warning" role="alert">{message}</p>}
            <button className="primary" disabled={saving || (mode === "changing" && !previewValid)}>{saving ? "Saving question..." : "Save question"}</button>
          </footer>
        </form>}
      </>}
    </section>
  </main>;
}

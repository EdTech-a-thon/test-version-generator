"use client";

import Link from "next/link";
import { FormEvent, useDeferredValue, useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { VariantPreview } from "@/components/variant-preview";
import type { ParametricDefinition, VariableDefinition } from "@/lib/contracts";

const blankDefinition: ParametricDefinition = {
  variables: [],
  constraints: [],
  answerFormula: "",
  distractors: ["", "", ""],
  rounding: { mode: "decimals", value: 2 },
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

  return <section className="formula-editor">
    <div><p className="eyebrow">Changing values</p><h2>Set up the values</h2><p className="helper">Use a value in the question stem with double curly brackets, such as <code>{"{{m}}"}</code>.</p></div>
    {definition.variables.filter((value): value is VariableDefinition => value.type !== "dataset").map((variable, index) => <div className="variable-row" key={index}>
      <strong>Value {index + 1}</strong>
      <label>Name<input value={variable.name} onChange={(event) => updateVariable(index, "name", event.target.value)} /></label>
      <label>Smallest<input type="number" value={variable.min ?? ""} onChange={(event) => updateVariable(index, "min", event.target.value)} /></label>
      <label>Largest<input type="number" value={variable.max ?? ""} onChange={(event) => updateVariable(index, "max", event.target.value)} /></label>
      <button type="button" className="text-button" onClick={() => onChange({ ...definition, variables: definition.variables.filter((_, current) => current !== index) })}>Remove</button>
    </div>)}
    {definition.variables.length < 4 && <button type="button" className="secondary" onClick={() => onChange({ ...definition, variables: [...definition.variables, { name: "", type: "integer", min: 1, max: 10 }] })}>Add a changing value</button>}
    <label>Correct answer calculation<input value={definition.answerFormula} onChange={(event) => onChange({ ...definition, answerFormula: event.target.value })} placeholder="For example: m * a" /></label>
    <p className="helper">Use <code>*</code> for multiply and <code>/</code> for divide.</p>
    <fieldset><legend>Likely incorrect calculations</legend>{definition.distractors.map((distractor, index) => <label key={index}>Wrong answer {index + 1}<input value={typeof distractor === "string" ? distractor : ""} onChange={(event) => onChange({ ...definition, distractors: definition.distractors.map((value, current) => current === index ? event.target.value : value) })} /></label>)}</fieldset>
    <div className="two-col"><label>Answer unit (optional)<input value={definition.unit ?? ""} onChange={(event) => onChange({ ...definition, unit: event.target.value })} placeholder="For example: N" /></label><label>Decimal places<select value={definition.rounding.value} onChange={(event) => onChange({ ...definition, rounding: { mode: "decimals", value: Number(event.target.value) } })}>{[0, 1, 2, 3].map((value) => <option value={value} key={value}>{value}</option>)}</select></label></div>
    <label>Optional rule<textarea value={definition.constraints[0] ?? ""} onChange={(event) => onChange({ ...definition, constraints: event.target.value.trim() ? [event.target.value] : [] })} rows={2} placeholder="For example: m != a" /></label>
  </section>;
}

export default function NewQuestion() {
  const [parametric, setParametric] = useState(false);
  const [definition, setDefinition] = useState(blankDefinition);
  const deferredDefinition = useDeferredValue(definition);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [banks, setBanks] = useState<Array<{ id: string; name: string }>>([]);
  const [bankId, setBankId] = useState("");

  useEffect(() => { void fetch("/api/banks").then((response) => response.json()).then((data) => { if (Array.isArray(data)) { setBanks(data); setBankId(data[0]?.id ?? ""); } }); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const values = new FormData(event.currentTarget);
    const options = ["A", "B", "C", "D"].map((id) => ({ id, text: String(values.get(`option-${id}`) ?? "") })).filter((option) => option.text.trim());
    const correct = String(values.get("correct") ?? "");
    try {
      const response = await fetch("/api/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bankIds: bankId ? [bankId] : [], type: "MULTIPLE_CHOICE", stem: values.get("stem"), options, correctAnswer: correct ? [correct] : [], difficulty: Number(values.get("difficulty")), points: Number(values.get("points")), tags: String(values.get("tags")).split(",").map((tag) => tag.trim()).filter(Boolean), solution: values.get("solution"), parametric: parametric ? definition : undefined }) });
      const data = await response.json();
      setMessage(response.ok ? "Question saved. It is ready to use in a test." : data.error ?? "Could not save question.");
    } catch {
      setMessage("Could not save question. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const canPreview = definition.variables.length > 0 && definition.variables.every((variable) => variable.type !== "dataset" && Boolean(variable.name) && variable.min !== undefined && variable.max !== undefined) && Boolean(definition.answerFormula.trim()) && definition.distractors.every((distractor) => typeof distractor !== "string" || distractor.trim());

  return <main><AppHeader current="Author a question" /><section className="workspace"><div className="section-heading"><div><p className="eyebrow">Step 2 of 3: Build your library</p><h1>Author a question</h1><p className="lead">Add a reusable multiple-choice question, then use it in any test you create.</p></div><Link className="quiet-link" href="/banks">Back to question banks</Link></div>{message && <p className="notice" role="status">{message} {message.startsWith("Question saved") && <Link href="/tests/new">Create a test</Link>}</p>}<form onSubmit={save} className="editor-grid"><section className="editor"><label>Question bank<select value={bankId} onChange={(event) => setBankId(event.target.value)} required><option value="">Choose a bank</option>{banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label>{!banks.length && <p className="warning">Create a <Link href="/banks">question bank</Link> before saving a question.</p>}<label>Question stem<textarea name="stem" rows={4} required /></label><div className="two-col"><label>Difficulty<select name="difficulty" defaultValue="3">{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></label><label>Points<input name="points" defaultValue="1" type="number" min="0.5" step="0.5" required /></label></div><label>Tags<input name="tags" placeholder="For example: mechanics, forces" /><span className="field-help">Separate tags with commas. Tests can use a tag to select the right questions.</span></label><fieldset><legend>Answer choices</legend><p className="field-help">Choose the correct answer using the circle beside it.</p>{["A", "B", "C", "D"].map((choice) => <label className="choice-input" key={choice}><input type="radio" name="correct" value={choice} aria-label={`Correct answer ${choice}`} /><span>{choice}</span><input name={`option-${choice}`} required /></label>)}</fieldset><label>Solution or teacher note (optional)<textarea name="solution" rows={3} /></label><label className="toggle"><input type="checkbox" checked={parametric} onChange={(event) => setParametric(event.target.checked)} /> This question uses changing values</label>{parametric && <FormulaEditor definition={definition} onChange={setDefinition} />}<button className="primary" disabled={saving || !banks.length}>{saving ? "Saving..." : "Save question"}</button></section>{parametric && <aside>{canPreview ? <VariantPreview definition={deferredDefinition} /> : <section className="preview"><p className="eyebrow">Required check</p><h2>Live variant preview</h2><p className="helper">Add at least one complete changing value, a correct answer calculation, and all incorrect calculations to see a preview.</p></section>}</aside>}</form></section></main>;
}

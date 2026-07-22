"use client";

import { useEffect, useState } from "react";
import type { GeneratedVariant, ParametricDefinition } from "@/lib/contracts";

export function VariantPreview({ definition }: { definition: ParametricDefinition }) {
  const [variants, setVariants] = useState<GeneratedVariant[]>([]);
  const [warning, setWarning] = useState("");
  const [loading, setLoading] = useState(false);
  const generate = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/parametric/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ definition, count: 4 }) });
      const result = await response.json();
      setVariants(result.variants ?? []);
      setWarning(result.warnings?.join(" ") ?? result.error ?? "");
    } catch {
      setVariants([]);
      setWarning("The preview could not be generated. Please try again.");
    } finally {
      setLoading(false);
    }
  };
  const definitionKey = JSON.stringify(definition);
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      void fetch("/api/parametric/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ definition, count: 4 }) })
        .then((response) => response.json())
        .then((result) => { if (current) { setVariants(result.variants ?? []); setWarning(result.warnings?.join(" ") ?? result.error ?? ""); } })
        .catch(() => { if (current) { setVariants([]); setWarning("The preview could not be generated. Please try again."); } });
    }, 350);
    return () => { current = false; window.clearTimeout(timer); };
  }, [definitionKey]);
  return <section className="preview"><div className="section-heading"><div><p className="eyebrow">Required check</p><h2>Live variant preview</h2></div><button type="button" onClick={() => void generate()} disabled={loading}>{loading ? "Generating..." : "Regenerate"}</button></div>{warning && <p className="warning">{warning}</p>}<div className="table-wrap"><table><thead><tr>{definition.variables.map((variable) => <th key={variable.name}>{variable.name}</th>)}<th>Correct</th>{definition.distractors.map((_, index) => <th key={index}>Distractor {index + 1}</th>)}<th>Valid</th></tr></thead><tbody>{variants.map((variant, index) => <tr key={index}>{definition.variables.map((variable) => { const value = variant.variables[variable.name]; return <td key={variable.name}>{typeof value === "object" ? JSON.stringify(value) : value}</td>; })}<td>{variant.correct}</td>{variant.distractors.map((distractor, distractorIndex) => <td key={distractorIndex}>{distractor}</td>)}<td><span className="badge success">Valid</span></td></tr>)}</tbody></table></div></section>;
}

"use client";

import { useState } from "react";
import { renderMarkup } from "@/lib/render-markup";
import type { GeneratedVariant, ParametricDefinition } from "@/lib/contracts";

function fillStem(stem: string, variant: GeneratedVariant) {
  return stem.replace(/{{\s*([\w]+)\s*}}/g, (token, name: string) => {
    const value = variant.variables[name];
    return typeof value === "number" || typeof value === "string" ? String(value) : token;
  });
}

export function VariantPreview({ definition, stem, onValidityChange }: { definition: ParametricDefinition; stem: string; onValidityChange: (valid: boolean) => void }) {
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
      onValidityChange(response.ok && Array.isArray(result.variants) && result.variants.length === 4 && !result.warnings?.length);
    } catch {
      setVariants([]);
      setWarning("The preview could not be generated. Please try again.");
      onValidityChange(false);
    } finally {
      setLoading(false);
    }
  };
  return <section className="preview variant-check"><div><p className="eyebrow">Required check</p><h2>Preview four versions</h2><p className="helper">Check that the question and answer choices make sense before saving.</p></div><button type="button" onClick={() => void generate()} disabled={loading}>{loading ? "Checking versions..." : variants.length ? "Check again" : "Preview versions"}</button>{warning && <p className="warning">{warning}</p>}{variants.length > 0 && <div className="variant-cards">{variants.map((variant, index) => <article className="variant-card" key={index}><p className="eyebrow">Example {index + 1}</p><strong>{renderMarkup(fillStem(stem, variant))}</strong><ol type="A">{variant.options.map((option) => <li className={option === variant.correct ? "correct-option" : ""} key={String(option)}>{renderMarkup(option)}{definition.unit ? ` ${definition.unit}` : ""}{option === variant.correct && <span> Correct</span>}</li>)}</ol></article>)}</div>}</section>;
}

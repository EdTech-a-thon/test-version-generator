import { describe, expect, it } from "vitest";
import { evaluateExpression, generateVariants } from "@/lib/parametric";

const definition = { variables: [{ name: "m", type: "integer" as const, min: 2, max: 10 }, { name: "a", type: "integer" as const, min: 1, max: 9 }], constraints: ["m != a"], answerFormula: "m*a", distractors: ["m+a", "m-a", "m/a"], rounding: { mode: "decimals" as const, value: 2 } };
describe("parametric engine", () => {
  it("generates unique collision-free force variants", async () => { const result = await generateVariants(definition, 50); expect(result.variants).toHaveLength(50); expect(new Set(result.variants.map((item) => `${item.variables.m},${item.variables.a}`)).size).toBe(50); for (const item of result.variants) { expect(item.correct).toBe(Number(item.variables.m) * Number(item.variables.a)); expect(new Set(item.options).size).toBe(4); } });
  it("blocks dangerous math functions", async () => { await expect(evaluateExpression("import('x')")).rejects.toThrow(); await expect(evaluateExpression("evaluate('2+2')")).rejects.toThrow(); });
  it("returns partial output for impossible constraints", async () => { const result = await generateVariants({ ...definition, constraints: ["m*a == 97"] }, 5); expect(result.variants).toHaveLength(0); expect(result.warnings.join(" ")).toContain("Partial"); });
});

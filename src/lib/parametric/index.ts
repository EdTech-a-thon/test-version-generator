import type {
  DatasetVariableDefinition,
  GeneratedVariant,
  ParametricDefinition,
  ParametricVariable,
  RoundingRule,
  VariableDefinition,
} from "../contracts";
import { createExpressionEvaluator } from "./expression";

// Leave time for callers to return a partial result before their own timeout.
const BATCH_TIMEOUT_MS = 4_000;

export type GenerateVariantsResult = {
  variants: GeneratedVariant[];
  warnings: string[];
};

function decimalPlaces(value: number): number {
  const text = value.toString().toLowerCase();
  if (text.includes("e-")) {
    const [coefficient, exponent] = text.split("e-");
    return Number(exponent) + (coefficient.split(".")[1]?.length ?? 0);
  }
  return text.split(".")[1]?.length ?? 0;
}

function domainFor(variable: VariableDefinition): number[] {
  if (variable.values) {
    return [...new Set(variable.values)].filter(
      (value) => Number.isFinite(value) && (variable.type !== "integer" || Number.isInteger(value)),
    );
  }
  if (variable.min === undefined || variable.max === undefined) return [];

  const step = variable.step ?? (variable.type === "integer" ? 1 : 10 ** -(variable.precision ?? 2));
  if (!Number.isFinite(step) || step <= 0 || variable.min > variable.max) return [];

  const precision = variable.type === "integer" ? 0 : variable.precision ?? Math.max(decimalPlaces(step), decimalPlaces(variable.min));
  const scale = 10 ** Math.min(12, precision);
  const start = Math.round(variable.min * scale);
  const end = Math.round(variable.max * scale);
  const increment = Math.max(1, Math.round(step * scale));
  const values: number[] = [];
  for (let value = start; value <= end && values.length < 1_000_000; value += increment) {
    values.push(value / scale);
  }
  return values;
}

function isDataset(variable: ParametricVariable): variable is DatasetVariableDefinition {
  return variable.type === "dataset";
}

function round(value: number, rule: RoundingRule): number {
  if (rule.mode === "decimals") {
    const scale = 10 ** rule.value;
    return Math.round((value + Number.EPSILON) * scale) / scale;
  }
  if (value === 0) return 0;
  const scale = 10 ** (rule.value - 1 - Math.floor(Math.log10(Math.abs(value))));
  return Math.round((value + Math.sign(value) * Number.EPSILON) * scale) / scale;
}

function shuffle<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

function variablesUsed(expression: string, names: Set<string>): string[] {
  const identifiers = expression.match(/[A-Za-z_]\w*/g) ?? [];
  return [...new Set(identifiers.filter((identifier) => names.has(identifier)))];
}

function constraintExpression(constraint: string): string {
  return `(${constraint}) ? 1 : 0`;
}

async function pruneUnaryDomains(
  domains: Map<string, number[]>,
  constraints: string[],
  evaluate: ReturnType<typeof createExpressionEvaluator>,
): Promise<void> {
  const names = new Set(domains.keys());
  for (const constraint of constraints) {
    const used = variablesUsed(constraint, names);
    if (used.length !== 1) continue;
    const name = used[0];
    const kept: number[] = [];
    for (const value of domains.get(name) ?? []) {
      try {
        if ((await evaluate(constraintExpression(constraint), { [name]: value })) !== 0) kept.push(value);
      } catch {
        // An invalid constraint value cannot produce a valid tuple.
      }
    }
    domains.set(name, kept);
  }
}

async function constraintsPass(
  constraints: string[],
  variables: Record<string, number>,
  evaluate: ReturnType<typeof createExpressionEvaluator>,
): Promise<boolean> {
  for (const constraint of constraints) {
    try {
      if ((await evaluate(constraintExpression(constraint), variables)) === 0) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function generateVariants(
  definition: ParametricDefinition,
  requestedCount: number,
): Promise<GenerateVariantsResult> {
  const count = Math.max(0, Math.floor(requestedCount));
  const numericVariables = definition.variables.filter((variable): variable is VariableDefinition => !isDataset(variable));
  const datasetVariables = definition.variables.filter(isDataset);
  const domains = new Map(numericVariables.map((variable) => [variable.name, domainFor(variable)]));
  const variants: GeneratedVariant[] = [];
  const warnings: string[] = [];
  const tupleKeys = new Set<string>();
  const startedAt = Date.now();
  const evaluate = createExpressionEvaluator();

  const duplicateName = definition.variables.find(
    (variable, index) => definition.variables.findIndex((candidate) => candidate.name === variable.name) !== index,
  );
  if (duplicateName) {
    warnings.push(`Generated 0 of ${count} variants: variable name ${duplicateName.name} is duplicated.`);
    return { variants, warnings };
  }

  await pruneUnaryDomains(domains, definition.constraints, evaluate);
  const emptyVariable = numericVariables.find((variable) => (domains.get(variable.name)?.length ?? 0) === 0)
    ?? datasetVariables.find((variable) => variable.rows.length === 0);
  if (emptyVariable) {
    warnings.push(`Generated 0 of ${count} variants: variable ${emptyVariable.name} has no valid values.`);
    return { variants, warnings };
  }

  const combinationCount = [...domains.values()].reduce((total, domain) => total * domain.length, 1)
    * datasetVariables.reduce((total, variable) => total * variable.rows.length, 1);
  const retryCap = Math.min(200 * count, Math.max(count, combinationCount * 4));
  let attempts = 0;
  while (variants.length < count && attempts < retryCap && Date.now() - startedAt < BATCH_TIMEOUT_MS) {
    attempts += 1;
    const numericValues = Object.fromEntries(
      numericVariables.map((variable) => {
        const domain = domains.get(variable.name)!;
        return [variable.name, domain[Math.floor(Math.random() * domain.length)]];
      }),
    );
    const datasetRows = Object.fromEntries(datasetVariables.map((variable) => [variable.name, variable.rows[Math.floor(Math.random() * variable.rows.length)]]));
    const expressionValues: Record<string, number> = { ...numericValues };
    for (const [name, row] of Object.entries(datasetRows)) {
      for (const [column, value] of Object.entries(row.values)) {
        if (typeof value === "number") expressionValues[`${name}_${column}`] = value;
      }
    }
    const variables: GeneratedVariant["variables"] = {
      ...numericValues,
      ...Object.fromEntries(Object.entries(datasetRows).map(([name, row]) => [name, row.values])),
    };
    const tupleKey = [...numericVariables.map((variable) => numericValues[variable.name]), ...Object.values(datasetRows).map((row) => row.id)].join("\u001f");
    if (tupleKeys.has(tupleKey) || !(await constraintsPass(definition.constraints, expressionValues, evaluate))) continue;

    try {
      const correct = definition.answerFormula.includes("{{")
        ? interpolate(definition.answerFormula, variables)
        : round(await evaluate(definition.answerFormula, expressionValues), definition.rounding);
      const distractors: Array<number | string> = [];
      for (const distractor of definition.distractors) {
        if (typeof distractor === "string") {
          distractors.push(distractor.includes("{{") ? interpolate(distractor, variables) : round(await evaluate(distractor, expressionValues), definition.rounding));
          continue;
        }
        const dataset = datasetVariables.find((variable) => variable.name === distractor.dataset);
        const correctRow = datasetRows[distractor.dataset];
        if (!dataset || !correctRow) throw new Error("Sampled distractor references an unknown dataset");
        let candidates = dataset.rows.filter((row) => row.id !== correctRow.id && !distractor.excludeRowIds?.includes(row.id));
        if (distractor.sameAs) candidates = candidates.filter((row) => row.values[distractor.sameAs!] === correctRow.values[distractor.sameAs!]);
        const picks = shuffle(candidates).slice(0, distractor.count ?? 1);
        if (picks.length < (distractor.count ?? 1)) throw new Error("Dataset does not have enough plausible distractor rows");
        distractors.push(...picks.map((row) => row.values[distractor.column]).filter((value): value is string | number => typeof value === "string" || typeof value === "number"));
      }
      const options = [correct, ...distractors];
      if (new Set(options).size !== options.length) continue;

      tupleKeys.add(tupleKey);
      variants.push({
        variables,
        correct,
        distractors,
        options: shuffle(options),
        valid: true,
      });
    } catch {
      // Invalid formula results are rejected and another tuple is attempted.
    }
  }

  if (variants.length < count) {
    const reason = Date.now() - startedAt >= BATCH_TIMEOUT_MS ? "the 5 second batch limit was reached" : "the retry limit was reached";
    warnings.push(`Partial result: generated ${variants.length} of ${count} variants because ${reason}.`);
  }
  return { variants, warnings };
}

export function interpolate(template: string, variables: GeneratedVariant["variables"]): string {
  return template.replace(/{{\s*([\w]+)(?:\.([\w]+))?\s*}}/g, (token, variable: string, column?: string) => {
    const value = variables[variable];
    if (column && value && typeof value === "object") return String(value[column] ?? token);
    return typeof value === "object" || value === undefined ? token : String(value);
  });
}

export { evaluateExpression } from "./expression";

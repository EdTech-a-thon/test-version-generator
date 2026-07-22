import { NextResponse } from "next/server";
import { z } from "zod";
import { saveQuestion } from "@/lib/questions";
import { requireTenantRole } from "@/lib/tenant";
import { generateVariants } from "@/lib/parametric";

const numericVariable = z.object({ name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/), type: z.enum(["integer", "decimal"]), min: z.number(), max: z.number(), step: z.number().optional(), precision: z.number().optional(), values: z.array(z.number()).optional() }).refine((value) => value.min <= value.max, "The smallest value must not exceed the largest value.");
const datasetVariable = z.object({ name: z.string().min(1), type: z.literal("dataset"), rows: z.array(z.object({ id: z.string(), values: z.record(z.union([z.string(), z.number()])) })) });
const sampledDistractor = z.object({ mode: z.literal("sampled"), dataset: z.string(), column: z.string(), count: z.number().optional(), sameAs: z.string().optional(), excludeRowIds: z.array(z.string()).optional() });

const parametricDefinition = z.object({
  variables: z.array(z.union([numericVariable, datasetVariable])).min(1).max(4),
  constraints: z.array(z.string()),
  answerFormula: z.string().trim().min(1),
  distractors: z.array(z.union([z.string().trim().min(1), sampledDistractor])).min(1),
  unit: z.string().optional(),
  rounding: z.object({ mode: z.enum(["decimals", "sigfigs"]), value: z.number().int().min(0).max(10) }),
});

const question = z.object({ id: z.string().optional(), bankIds: z.array(z.string()).min(1), type: z.enum(["MULTIPLE_CHOICE", "MULTIPLE_SELECT", "TRUE_FALSE", "NUMERIC", "SHORT_ANSWER", "ESSAY"]), stem: z.string().trim().min(1), options: z.array(z.object({ id: z.string().min(1), text: z.string().trim().min(1), pinLast: z.boolean().optional() })).max(5), correctAnswer: z.array(z.string()), difficulty: z.number().int().min(1).max(5), points: z.number().positive(), tags: z.array(z.string()), solution: z.string().optional(), rubric: z.string().optional(), parametric: parametricDefinition.optional() }).superRefine((value, context) => {
  const choiceTypes = ["MULTIPLE_CHOICE", "MULTIPLE_SELECT", "TRUE_FALSE", "NUMERIC"];
  if (!value.parametric && choiceTypes.includes(value.type) && value.options.length < 2) context.addIssue({ code: "custom", message: "Choice questions need at least two options." });
  if (!value.parametric && ["MULTIPLE_CHOICE", "TRUE_FALSE", "NUMERIC"].includes(value.type) && value.correctAnswer.length !== 1) context.addIssue({ code: "custom", message: "Choose the correct answer." });
  if (value.correctAnswer.some((answer) => !value.options.some((option) => option.id === answer))) context.addIssue({ code: "custom", message: "Each correct answer must match an option." });
});
export async function POST(request: Request) { try { const tenant = await requireTenantRole(["OWNER", "ADMIN", "EDITOR"]); const input = question.parse(await request.json()); if (input.parametric) { const preview = await generateVariants(input.parametric, 4); if (preview.variants.length < 4 || preview.warnings.length) throw new Error("Preview four valid versions before saving this question."); } return NextResponse.json({ id: await saveQuestion(tenant, input) }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save question." }, { status: 400 }); } }

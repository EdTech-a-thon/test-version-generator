import { NextResponse } from "next/server";
import { z } from "zod";
import { saveQuestion } from "@/lib/questions";
import { requireTenantRole } from "@/lib/tenant";

const question = z.object({ id: z.string().optional(), bankIds: z.array(z.string()).min(1), type: z.enum(["MULTIPLE_CHOICE", "MULTIPLE_SELECT", "TRUE_FALSE", "NUMERIC", "SHORT_ANSWER", "ESSAY"]), stem: z.string().min(1), options: z.array(z.object({ id: z.string().min(1), text: z.string().min(1), pinLast: z.boolean().optional() })).max(5), correctAnswer: z.array(z.string()), difficulty: z.number().int().min(1).max(5), points: z.number().positive(), tags: z.array(z.string()), solution: z.string().optional(), rubric: z.string().optional(), parametric: z.any().optional() }).superRefine((value, context) => {
  const choiceTypes = ["MULTIPLE_CHOICE", "MULTIPLE_SELECT", "TRUE_FALSE", "NUMERIC"];
  if (choiceTypes.includes(value.type) && value.options.length < 2) context.addIssue({ code: "custom", message: "Choice questions need at least two options." });
  if (["MULTIPLE_CHOICE", "TRUE_FALSE", "NUMERIC"].includes(value.type) && value.correctAnswer.length !== 1) context.addIssue({ code: "custom", message: "This question type needs exactly one correct answer." });
  if (value.correctAnswer.some((answer) => !value.options.some((option) => option.id === answer))) context.addIssue({ code: "custom", message: "Each correct answer must match an option." });
});
export async function POST(request: Request) { try { const tenant = await requireTenantRole(["OWNER", "ADMIN", "EDITOR"]); return NextResponse.json({ id: await saveQuestion(tenant, question.parse(await request.json())) }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save question." }, { status: 400 }); } }

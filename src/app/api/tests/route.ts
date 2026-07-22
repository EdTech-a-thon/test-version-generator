import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { assembleForms } from "@/lib/assembly";
import { letter } from "@/lib/format";
import { requireTenantRole } from "@/lib/tenant";
import { generateVariants, interpolate } from "@/lib/parametric";
import type { ParametricDefinition, RenderedFormItem } from "@/lib/contracts";

const schema = z.object({
  title: z.string().trim().min(1).max(150),
  formCount: z.number().int().min(1).max(26),
  tag: z.string().trim().optional(),
  itemCount: z.number().int().min(1).max(100),
  targetDifficulty: z.number().int().min(1).max(5).optional(),
  scrambleChoices: z.boolean(),
  strictDifficulty: z.boolean(),
});

type StoredOptions = Array<{ id: string; text: string; pinLast?: boolean }>;

export async function POST(request: Request) {
  try {
    const tenant = await requireTenantRole(["OWNER", "ADMIN", "EDITOR"]);
    const input = schema.parse(await request.json());
    const questions = await db.question.findMany({
      where: {
        orgId: tenant.orgId,
        status: "ACTIVE",
        ...(input.tag ? { tags: { some: { name: input.tag.toLowerCase() } } } : {}),
        ...(input.strictDifficulty && input.targetDifficulty ? { difficulty: input.targetDifficulty } : {}),
      },
      include: { currentVersion: true },
    });
    if (questions.length < input.itemCount) {
      throw new Error(`Only ${questions.length} matching questions are available. Add more questions or lower the item count.`);
    }
    const selected = [...questions].sort(() => Math.random() - 0.5).slice(0, input.itemCount);
    const parametricVariants = new Map<string, Awaited<ReturnType<typeof generateVariants>>>();
    for (const question of selected) {
      const definition = (question.content as { parametric?: ParametricDefinition } | null)?.parametric;
      if (definition) parametricVariants.set(question.id, await generateVariants(definition, input.formCount));
    }
    const items = selected.map((question) => {
      const options = ((question.content as { options?: StoredOptions } | null)?.options ?? []);
      const answerIds = Array.isArray(question.correctAnswer) ? question.correctAnswer.filter((answer): answer is string => typeof answer === "string") : [];
      const correctIndexes = answerIds.map((answer) => options.findIndex((option) => option.id === answer)).filter((index) => index >= 0);
      const freeResponse = ["SHORT_ANSWER", "ESSAY"].includes(question.type);
      if (!freeResponse && !parametricVariants.has(question.id) && (options.length < 2 || !correctIndexes.length)) throw new Error(`"${question.stem}" needs answer choices and a correct answer before it can be used.`);
      return { id: question.id, type: question.type, difficulty: question.difficulty, points: Number((question.content as { points?: number } | null)?.points ?? 1), options: options.map((option) => option.text), correctIndexes, pinLast: options.at(-1)?.pinLast };
    });
    const assembled = assembleForms(items, input.formCount, input.strictDifficulty, input.targetDifficulty);
    const test = await db.$transaction(async (tx) => {
      const created = await tx.test.create({
        data: { orgId: tenant.orgId, createdById: tenant.userId, title: input.title, assemblyMode: input.strictDifficulty ? "STRICT" : "SOFT", scrambleChoices: input.scrambleChoices, formCount: input.formCount },
      });
      for (const form of assembled.forms) {
        const formRecord = await tx.form.create({ data: { orgId: tenant.orgId, testId: created.id, code: form.code, scrambleChoices: input.scrambleChoices } });
        await tx.formItem.createMany({
          data: form.items.map((item, itemIndex) => {
            const question = selected.find((candidate) => candidate.id === item.id);
            if (!question?.currentVersionId) throw new Error("A selected question has no saved version.");
            const sourceOptions = ((question.content as { options?: StoredOptions } | null)?.options ?? []);
            const definition = (question.content as { parametric?: ParametricDefinition } | null)?.parametric;
            const variant = definition ? parametricVariants.get(question.id)?.variants[form.code.charCodeAt(0) - 65] : undefined;
            if (definition && !variant) throw new Error(`Could not generate enough distinct variants for "${question.stem}".`);
            const renderedOptions = variant
              ? variant.options.map((value, index) => ({ id: `generated-${index}`, text: `${value}${definition?.unit ? ` ${definition.unit}` : ""}` }))
              : sourceOptions;
            const correctAnswer = variant
              ? [renderedOptions.find((option) => option.text === `${variant.correct}${definition?.unit ? ` ${definition.unit}` : ""}`)?.id ?? "generated-0"]
              : Array.isArray(question.correctAnswer) ? question.correctAnswer.filter((answer): answer is string => typeof answer === "string") : [];
            const rendered: RenderedFormItem = {
              type: question.type,
              stem: variant ? interpolate(question.stem, variant.variables) : question.stem,
              options: renderedOptions,
              correctAnswer,
              solution: (question.solution as { text?: string } | null)?.text,
              rubric: (question.rubric as { text?: string } | null)?.text,
              generatedVariant: variant,
            };
            const correctIndexes = correctAnswer.map((answer) => renderedOptions.findIndex((option) => option.id === answer)).filter((index) => index >= 0);
            const choiceOrder = renderedOptions.length
              ? (input.scrambleChoices ? item.optionOrder : renderedOptions.map((_, index) => index))
              : [];
            return {
              orgId: tenant.orgId,
              formId: formRecord.id,
              questionId: question.id,
              questionVersionId: question.currentVersionId,
              position: itemIndex + 1,
              points: item.points,
              generatedParams: rendered,
              choiceOrder,
              correctLetters: choiceOrder.length ? correctIndexes.map((correct) => letter(choiceOrder.indexOf(correct))) : [],
            };
          }),
        });
      }
      return created;
    });
    return NextResponse.json({ id: test.id, warnings: assembled.warnings }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not generate forms." }, { status: 400 });
  }
}

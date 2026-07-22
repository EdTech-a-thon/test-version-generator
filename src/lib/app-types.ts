import type { ParametricDefinition } from "@/lib/contracts";

export const questionTypes = [
  "MULTIPLE_CHOICE",
  "MULTIPLE_SELECT",
  "TRUE_FALSE",
  "NUMERIC",
  "SHORT_ANSWER",
  "ESSAY",
] as const;

export type QuestionTypeValue = (typeof questionTypes)[number];

export type QuestionDraft = {
  id?: string;
  bankIds: string[];
  type: QuestionTypeValue;
  stem: string;
  options: Array<{ id: string; text: string; pinLast?: boolean }>;
  correctAnswer: string[];
  difficulty: number;
  points: number;
  tags: string[];
  solution?: string;
  rubric?: string;
  parametric?: ParametricDefinition;
};

export type AssemblyRule = {
  tag?: string;
  type?: QuestionTypeValue;
  difficulty?: number;
  count: number;
};

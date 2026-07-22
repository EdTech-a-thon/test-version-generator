import type { GeneratedVariant } from "@/lib/contracts";

export type AssemblyItem = {
  id: string;
  type?: string;
  difficulty: number;
  points: number;
  options: string[];
  correctIndexes: number[];
  pinLast?: boolean;
  variant?: GeneratedVariant;
};

export type AssembledForm = {
  code: string;
  items: Array<AssemblyItem & { optionOrder: number[]; correctLetters: string[] }>;
  difficultyAverage: number;
};

function shuffledIndexes(length: number, pinLast: boolean) {
  const indexes = Array.from({ length }, (_, index) => index);
  const tail = pinLast ? indexes.pop() : undefined;
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [indexes[index], indexes[other]] = [indexes[other], indexes[index]];
  }
  if (tail !== undefined) indexes.push(tail);
  return indexes;
}

export function assembleForms(items: AssemblyItem[], count: number, strictDifficulty = false, targetDifficulty?: number) {
  if (!items.length) throw new Error("Add at least one item before generating forms.");
  const warnings: string[] = [];
  const forms: AssembledForm[] = Array.from({ length: count }, (_, formIndex) => {
    const formItems = [...items];
    for (let index = formItems.length - 1; index > 0; index -= 1) {
      const other = Math.floor(Math.random() * (index + 1));
      [formItems[index], formItems[other]] = [formItems[other], formItems[index]];
    }
    const assembled = formItems.map((item) => {
      const optionOrder = item.options.length ? shuffledIndexes(item.options.length, item.pinLast ?? false) : [];
      const correctLetters = item.correctIndexes.map((correct) => String.fromCharCode(65 + optionOrder.indexOf(correct)));
      return { ...item, optionOrder, correctLetters };
    });
    return {
      code: String.fromCharCode(65 + formIndex),
      items: assembled,
      difficultyAverage: assembled.reduce((sum, item) => sum + item.difficulty, 0) / assembled.length,
    };
  });
  if (targetDifficulty && forms.some((form) => Math.abs(form.difficultyAverage - targetDifficulty) > 0.5)) {
    const message = "The available pool could not meet the requested difficulty target.";
    if (strictDifficulty) throw new Error(message);
    warnings.push(message);
  }
  return { forms, warnings };
}

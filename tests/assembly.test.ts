import { describe, expect, it } from "vitest";
import { assembleForms } from "@/lib/assembly";

describe("assembly", () => {
  it("scrambles choices and retains correct letters", () => {
    const result = assembleForms([{ id: "Force?", difficulty: 3, points: 1, options: ["8 N", "6 N", "4 N", "2 N"], correctIndexes: [0] }], 4, false, 3);
    expect(result.forms).toHaveLength(4);
    for (const form of result.forms) expect(form.items[0].correctLetters).toHaveLength(1);
  });
  it("rejects an unmet strict difficulty target", () => {
    expect(() => assembleForms([{ id: "q", difficulty: 1, points: 1, options: ["a"], correctIndexes: [0] }], 1, true, 5)).toThrow("difficulty");
  });
});

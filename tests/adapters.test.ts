import { describe, expect, it } from "vitest";

import type { ExportableForm } from "../src/lib/contracts";
import {
  GenericCsvKeyAdapter,
  GradeCamKeyAdapter,
  ScantronKeyAdapter,
  ZipGradeKeyAdapter,
} from "../src/lib/export";

const form: ExportableForm = {
  id: "form-1",
  formCode: "A,1",
  items: [
    { position: 2, correctLetters: ["B", "D"], points: 2.5 },
    { position: 1, correctLetters: ["A"], points: 1 },
  ],
};

describe("key export adapters", () => {
  it("formats a deterministic, escaped generic CSV", () => {
    const adapter = new GenericCsvKeyAdapter();

    expect(adapter.confirmed).toBe(true);
    expect(adapter.format(form)).toBe(
      'form_code,position,correct_letters,points\n"A,1",1,A,1\n"A,1",2,B|D,2.5\n',
    );
  });

  it("marks Scantron placeholder columns as unconfirmed", () => {
    const adapter = new ScantronKeyAdapter();

    expect(adapter.confirmed).toBe(false);
    expect(adapter.format(form)).toContain("FORM,QUESTION,ANSWER,POINTS");
  });

  it.each([new ZipGradeKeyAdapter(), new GradeCamKeyAdapter()])(
    "$name is an explicitly unconfirmed stub",
    (adapter) => {
      expect(adapter.confirmed).toBe(false);
      expect(() => adapter.format(form)).toThrow(/not implemented/);
    },
  );
});

import * as XLSX from "xlsx";

import type { ExtractedCandidate, ExtractionInput } from "../contracts";

export type SpreadsheetCell = string | number | boolean | null;
export type SpreadsheetRow = Record<string, SpreadsheetCell>;

export type SpreadsheetColumnMapping = {
  stem: string;
  type?: string;
  options?: string[];
  correctAnswer?: string;
  difficulty?: string;
  tags?: string;
};

function cellText(value: SpreadsheetCell | undefined): string {
  return value == null ? "" : String(value).trim();
}

export function parseSpreadsheet(bytes: Uint8Array): SpreadsheetRow[] {
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false, raw: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  return XLSX.utils.sheet_to_json<SpreadsheetRow>(workbook.Sheets[firstSheetName], {
    defval: null,
    raw: true,
  });
}

export function mapSpreadsheetRows(
  rows: SpreadsheetRow[],
  mapping: SpreadsheetColumnMapping,
): ExtractedCandidate[] {
  return rows.flatMap((row) => {
    const stem = cellText(row[mapping.stem]);
    if (!stem) return [];

    const options = (mapping.options ?? [])
      .map((column) => cellText(row[column]))
      .filter(Boolean);
    const correctAnswer = mapping.correctAnswer
      ? cellText(row[mapping.correctAnswer]) || undefined
      : undefined;
    const difficultyText = mapping.difficulty ? cellText(row[mapping.difficulty]) : "";
    const difficulty = difficultyText === "" ? undefined : Number(difficultyText);

    return [{
      stem,
      type: mapping.type ? cellText(row[mapping.type]) || "multiple-choice" : "multiple-choice",
      options,
      correctAnswer,
      difficulty: difficulty !== undefined && Number.isFinite(difficulty) ? difficulty : undefined,
      tags: mapping.tags
        ? cellText(row[mapping.tags]).split(",").map((tag) => tag.trim()).filter(Boolean)
        : [],
      // Imported answers always require human confirmation; confidence is never approval.
      confidence: { stem: 0, options: 0, correctAnswer: 0 },
    }];
  });
}

export function extractSpreadsheet(
  input: ExtractionInput,
  mapping: SpreadsheetColumnMapping,
): ExtractedCandidate[] {
  return mapSpreadsheetRows(parseSpreadsheet(input.bytes), mapping);
}

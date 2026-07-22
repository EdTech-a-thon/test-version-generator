import type { ExportableForm, KeyExportAdapter } from "../contracts";

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export class GenericCsvKeyAdapter implements KeyExportAdapter {
  readonly name = "Generic CSV";
  readonly confirmed = true;

  format(form: ExportableForm): string {
    const rows: Array<Array<string | number>> = [
      ["form_code", "position", "correct_letters", "points"],
      ...[...form.items]
        .sort((left, right) => left.position - right.position)
        .map((item) => [
          form.formCode,
          item.position,
          item.correctLetters.join("|"),
          item.points,
        ]),
    ];
    return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
  }
}

export const genericCsvKeyAdapter = new GenericCsvKeyAdapter();

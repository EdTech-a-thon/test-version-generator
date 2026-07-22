import type { ExportableForm, KeyExportAdapter } from "../contracts";

// TODO(human): confirm exact Scantron product + key schema
export class ScantronKeyAdapter implements KeyExportAdapter {
  readonly name = "Scantron (placeholder)";
  readonly confirmed = false;

  format(form: ExportableForm): string {
    const rows: Array<Array<string | number>> = [
      ["FORM", "QUESTION", "ANSWER", "POINTS"],
      ...[...form.items]
        .sort((left, right) => left.position - right.position)
        .map((item) => [
          form.formCode,
          item.position,
          item.correctLetters.join("|"),
          item.points,
        ]),
    ];
    return `${rows.map((row) => row.join(",")).join("\n")}\n`;
  }
}

export const scantronKeyAdapter = new ScantronKeyAdapter();

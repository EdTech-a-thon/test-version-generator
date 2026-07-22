import type { ExportableForm, KeyExportAdapter } from "../contracts";

abstract class UnconfiguredVendorAdapter implements KeyExportAdapter {
  abstract readonly name: string;
  readonly confirmed = false;

  format(form: ExportableForm): string {
    void form;
    throw new Error(`${this.name} export is not implemented; confirm the vendor key schema first`);
  }
}

export class ZipGradeKeyAdapter extends UnconfiguredVendorAdapter {
  readonly name = "ZipGrade (stub)";
}

export class GradeCamKeyAdapter extends UnconfiguredVendorAdapter {
  readonly name = "GradeCam (stub)";
}

export const zipGradeKeyAdapter = new ZipGradeKeyAdapter();
export const gradeCamKeyAdapter = new GradeCamKeyAdapter();

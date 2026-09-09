# Export testing

## Purpose

The print-reference view is the authoritative presentation of an exam. PDF and
DOCX export must preserve the same semantics and put the same ordered content
on the same pages without reconstructing an exam independently.

This document describes the implemented architecture and its acceptance path.

## Architecture

Publication has one pure preparation boundary and one shared planning pipeline:

```text
Exam Draft + Version History + Content Selection
                    |
                    v
          publication preparation
       canonical test + key Layout Plans
       fingerprint + Version resolution
       selected plans + commit payload
                    |
                    v
          Export Document -> Layout Plan
                         /       \
                        v         v
          print-reference view   PDF / DOCX Export Adapters
```

`prepareExport({ exam, version, configuration, history, measure, createdAt })`
is the application-level pure seam. It always prepares separate canonical
student-test and answer-key plans, computes one name-independent Export
Fingerprint across both, resolves an existing or provisional friendly-named
Version, and returns the selected plans plus the immutable records required for
publication. Content Selection changes only which plans enter the selected
artifact; format and Content Selection do not change identity or which plans
are retained.

The current Exam Draft arrangement is the only arrangement publication uses.
Variation belongs to the authoring commands before export. A matching
fingerprint reuses its stored Version and plans. A new fingerprint receives a
unique adjective-noun name provisionally, and that name becomes permanent only
when the publication transaction commits.

`planExport({ exam, version, selection, measure })` remains the one-document
planning boundary. Semantic derivation into an Export Document and pagination
into a Layout Plan are internal stages. A Layout Plan is self-contained and
carries page size and assignment, furniture, stream, explicit breaks, and
ordered items. Export Adapters never inspect the Exam Draft, measure, or
repaginate.

The print adapter remains an internal preview/reference path (`ExportPreview`
in `src/exam-page.tsx`). PDF and DOCX are explicit product artifacts. All three
consume the same selected plans in student-test-then-answer-key order.

The browser packages the complete selected PDF or DOCX before persistence. It then
commits the Version (when new), new Question Revisions, both Layout Plans,
required Media Assets, and current authoring state in one IndexedDB transaction.
Only a successful transaction is followed by download. Browser cancellation
after that point cannot roll history back.

## Acceptance contract

The Export Document is the semantic oracle. The Reference PDF captured from
the clean print-reference preview is the layout oracle. A pinned LibreOffice
installation is the Comparison Engine used to make DOCX pagination observable.

Acceptance requires:

1. **Semantic parity:** exact ordered content, question and choice order,
   formatting intent, links, math, media, tables, whitespace, and answer data.
2. **Structural parity:** exact section hierarchy, grid topology, headers,
   footers, numbering, and explicit keep/break decisions.
3. **Page parity:** exact page count and dimensions, with the same ordered
   content assigned to each page.

Renderer-selected line wrapping, coordinates, fonts, generated identifiers,
package metadata, and raster appearance are not compared. Authored line breaks
remain semantic; explicit page breaks remain structural.

Parity covers the selected plans in order, restarts page numbering per stream,
and requires the friendly Version name on every page. Version identity is
always calculated from both canonical plans even when only one stream is
selected.

## Shared fingerprint

Plan, print-reference markup, and DOCX reduce to the same readable content-line
vocabulary:

```text
heading:<1-6|title> <inline>
para <inline>
code <inline>
list:<bullet|ordered>:<n> <inline>
rule
table:<rows>x<columns>
cell:<row>,<column>
/table
```

Inline content uses plain text, marked spans, links, math source, stable image
ordinals, and authored-break markers. The Version fingerprint additionally
includes immutable media hashes while removing the friendly name.

The implementations are:

- `src/pdf-export.ts` — the dedicated local PDF Export Adapter.
- `src/export-fingerprint.ts` — Export Document and Layout Plan fingerprints.
- `src/print-fingerprint.ts` — the print-reference adapter's real markup.
- `src/docx-fingerprint.ts` — a generated DOCX package.
- `src/export-preparation.ts` — the two-plan Version fingerprint and revision
  identity.

## Test layers

### Standard tests

`bun test` is dependency-free and covers:

- `src/export-preparation.test.ts` — canonical plan retention, stream order,
  fingerprint inclusions/exclusions, Version and Question Revision reuse,
  provisional naming, blank keys, validation, and filenames.
- `src/export-plan.test.ts` — semantic derivation, numbering, grids, geometry,
  packing, splitting, furniture, streams, and breaks.
- `src/export-parity.test.ts` — each fixture through the plan, print-reference,
  and DOCX fingerprints, including deliberate degradation checks.
- `src/docx-export.test.ts` — DOCX packaging, page sections, friendly names,
  answer keys, links, media bytes, lists, and strict unresolved-media rejection.
- `src/pdf-export.test.ts` — PDF pages, metadata, links, media, embedded fonts,
  unsupported-character rejection, and overflow rejection.
- `src/doc-view.test.ts` — authored whitespace in the read-only view.

The Playwright suite covers the browser workflow and real IndexedDB behavior:
default Content Selection, clean preview, New Version/re-export messaging,
focus and Cmd/Ctrl+P, first-publication persistent storage, atomic publication,
quota and transaction failures, required-media failure, no phantom download,
and an unchanged Exam Draft.

### Out-of-band comparison

`bun run test:exports` is the single heavyweight entry point. It:

1. Verifies LibreOffice, Poppler, and Playwright Chromium prerequisites.
2. Records tool versions, platform, locale, and paper size.
3. Seeds the real application, including content-addressed Media Assets.
4. Drives the real export dialog with both Content Selection streams.
5. Captures the clean print-reference preview as the Reference PDF.
6. Downloads the dedicated PDF and compares its normalized pages directly.
7. Downloads the real DOCX through the publication workflow.
8. Re-exports the media-rich composite from stored history and verifies its
   normalized DOCX structure is unchanged.
9. Compares structural fingerprints and normalized per-page PDF manifests.

PDF normalization keeps page boundaries, dimensions, and word order while
discarding coordinates and renderer-selected line grouping. Ruled blanks and
typeset math are excluded from word comparison and asserted structurally in the
fast suite.

### Invocation policy

The heavyweight comparison is not part of `bun test`, `bun run test:e2e`, or
CI. Run it when a change affects the Export Document, Layout Plan, either Export
Adapter, pagination, print styling, media rendering, or supported document-node
rendering.

### Prerequisites

| Tool                | Command                | Role                          |
| ------------------- | ---------------------- | ----------------------------- |
| LibreOffice         | `soffice`              | DOCX to PDF Comparison Engine |
| Poppler             | `pdftotext`, `pdfinfo` | normalized PDF manifests      |
| Playwright Chromium | —                      | Reference PDF capture         |

`LANG`, `LC_ALL`, and `TZ` are pinned to `C`/`UTC`; the PDF uses US Letter with
zero outer margin because the Layout Plan owns the page padding.

## Fixtures and failure artifacts

`src/export-fixtures.ts` holds one synthetic fixture per supported block, mark,
link, break, list, table, image, math, Question Type, and column setting, plus
pagination boundaries and a realistic media-rich composite. Generated binary
files are never test truth.

A failed heavyweight comparison keeps diagnostic material under
`export-artifacts/<fixture>/`: source fixture, normalized plans and adapter
fingerprints, DOCX, Reference and converted PDFs, manifests, reports, and an
environment record. Successful comparisons remove disposable converter state.

## Known limits

- Office Math stores the authored LaTeX source in a native equation object; it
  does not translate LaTeX into fully structured OMML.
- The PDF word comparison cannot adjudicate ruled blanks or typeset math; both
  remain covered structurally.
- Version History is browser-local. Persistent-storage permission strengthens
  local durability but is not an archival guarantee.

## Adding a supported document node

Add support in all four mappings — `doc-view.tsx`, `docx-export.ts`,
`export-fingerprint.ts`, and `print-fingerprint.ts` — and add the smallest
fixture to `src/export-fixtures.ts`. The parity suite asserts complete coverage
of `SUPPORTED_NODES`, `SUPPORTED_MARKS`, Question Types, column settings, and
page-header variants.

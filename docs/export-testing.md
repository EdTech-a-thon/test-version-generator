# Export testing

## Purpose

Print is the authoritative presentation of an exam. DOCX export must preserve the same document semantics and place the same ordered content on the same pages without maintaining an independent reconstruction of the exam.

This document describes the implemented architecture and the acceptance strategy that guards it.

## Architecture

The export pipeline has one shared semantic stage and one shared layout stage, both inside `src/export-plan.ts`:

```text
Exam + Version + content selection
                 |
                 v
          Export Document
                 |
                 v
            Layout Plan
              /      \
             v        v
    print Export    DOCX Export
       Adapter         Adapter
   (exam-page.tsx)  (docx-export.ts)
             |        |
             v        v
     Reference PDF   DOCX
```

`planExport({ exam, version, selection, measure })` is the whole planning interface. Semantic derivation into an Export Document and pagination into a Layout Plan are internal stages behind it; callers never orchestrate them.

The Layout Plan is self-contained. It carries the document title and version, the page size, the ordered pages, each page's header variant and furniture, its footer number, its stream (`test` or `answer-key`), its explicit `breakBefore`, and its ordered page items with question pieces and choice-grid cells. An adapter that has a plan needs neither the exam, the version, nor a `Measure`.

Measurement stays injected. `dom-measure.ts` is the production adapter; `unmeasured` and the stubs in `export-fixtures.ts` are the deterministic substitutes tests use. Export Adapters never measure and never repaginate.

## Acceptance contract

The Export Document is the semantic oracle. The Reference PDF is the layout oracle. A pinned LibreOffice installation is the Comparison Engine used to make DOCX pagination observable.

Acceptance requires all of the following:

1. **Semantic parity:** exact ordered content, question and choice identity and order, formatting intent, links, math, images, tables, authored whitespace, and metadata.
2. **Structural parity:** exact section hierarchy, choice-grid topology, headers, footers, numbering, and explicit keep and break decisions.
3. **Page parity:** exact page count and dimensions, with the same ordered content assigned to each page.

Renderer-chosen line wrapping and element coordinates are not compared. An authored line break remains semantic content and an explicit page break remains structural content. Raster appearance and fonts are not acceptance criteria. Parity applies when the DOCX is first exported and opened; reflow after a user edits it is outside the contract.

The current implementation covers one version's student test. Answer-key and multi-document export can extend the same representations later, but are separate product work.

## The shared fingerprint

Parity is asserted through one small vocabulary of content lines, so a plan, a printed page and a Word document can be compared directly:

```text
heading:<1-6|title> <inline>   a heading, at its level
para <inline>                  an ordinary paragraph
code <inline>                  a code block
list:<bullet|ordered>:<n> <inline>
rule                           a horizontal rule
table:<rows>x<columns>         a table or a choice grid opens
cell:<row>,<column>            one cell opens; its own lines follow
/table                         the table closes
```

and inline content as plain text, `«strong,emphasis»marked text«/»`, `«link:https://…»linked text«/»`, `⟨math:E = mc^2⟩`, `⟨image:2⟩` (the second image in document order), and `⏎` for an authored break.

Three modules produce it:

- `src/export-fingerprint.ts` — from a Layout Plan and from an Export Document. The reference side.
- `src/print-fingerprint.ts` — from the print Export Adapter's real markup.
- `src/docx-fingerprint.ts` — from a generated DOCX package.

The fingerprint deliberately excludes ZIP bytes and timestamps, package part ordering, generated relationship identifiers, revision metadata, style names, indentation, coordinates, and renderer-selected line wrapping.

## Test layers

### Standard tests

`bun test` stays dependency-free and covers:

- `src/export-plan.test.ts` — the planning interface: ordering, sections, numbering, choice letters, grid topology, page geometry, packing, splitting, furniture, streams, breaks, and the Export Document on its own.
- `src/export-parity.test.ts` — every fixture in `src/export-fixtures.ts`, three ways: the plan against the DOCX adapter, the plan against the print adapter, and the two adapters against each other. It also proves the comparison itself by degrading a real fingerprint the way the DOCX path used to differ and asserting each discrepancy is named.
- `src/docx-export.test.ts` — packaging: MIME type, ZIP signature, filename, page size, one Word section per planned page, link relationships, packaged image bytes, and list numbering.
- `src/doc-view.test.ts` — authored whitespace in the read-only document view.

Fixtures are committed as readable source in `src/export-fixtures.ts`. Generated DOCX and PDF binaries are never test truth.

### Out-of-band comparison

`bun run test:exports` is the single documented entry point. It:

1. Checks its prerequisites and reports exactly what is missing and how to install it. It never skips silently.
2. Records the resolved tool versions, platform, locale and paper size.
3. Seeds the real application with a fixture — its images included, put in the Cache Storage the image worker reads — waits for fonts and images to settle, and drives Export → Print… → Print selected.
4. Takes the print output's own markup and captures it with the pinned Playwright Chromium as the Reference PDF.
5. Downloads the real DOCX through the application's own Export menu.
6. Compares the DOCX's structural fingerprint against that printed markup. The reference is the document the browser actually laid out, with real measurement deciding where the pages fell — not a plan the diagnostic rebuilt for itself, which could not know what the browser measured.
7. Converts the DOCX with the pinned, headless LibreOffice Comparison Engine.
8. Extracts a normalized per-page manifest from both PDFs and compares page count, page dimensions, and ordered content per page.

PDF normalization keeps page boundaries, page dimensions and content order, and discards coordinates and the line grouping each renderer chose for itself: a page's content is compared as its ordered words. Ligatures and substituted dashes and quotes are normalized as typography rather than content.

Two things are deliberately outside the word comparison, because neither is text and neither renderer writes them the same way:

- **Blanks.** A blank for a student to write on is a ruled box in print and a run of underscores in Word. Runs of underscores are dropped from both sides; that the blank exists is asserted structurally in the fast suite, as the planned `_______ 1.` line.
- **Typeset mathematics.** KaTeX lays an equation out as glyph boxes that extract as spaced characters; an Office Math object may extract as nothing. The words of each equation the document actually contains are dropped from both sides; that the equation exists, and what its source is, is asserted structurally as `⟨math:…⟩`.

The application keeps its print document mounted until `afterprint`, rather than unmounting in the animation frame after `window.print()`. That is what lets a print preview re-read the DOM and what lets a headless capture read it at all; the diagnostic stands in for the dialog by making `window.print()` a no-op, so no `afterprint` follows and the document stays put.

Prerequisites, and what each is for:

| Tool | Command | Role | Install |
| --- | --- | --- | --- |
| LibreOffice | `soffice` | Comparison Engine: DOCX → PDF | `apt-get install -y libreoffice-writer` |
| Poppler | `pdftotext` | ordered content per page | `apt-get install -y poppler-utils` |
| Poppler | `pdfinfo` | page count and dimensions | `apt-get install -y poppler-utils` |
| Playwright Chromium | — | Reference PDF capture | `bunx playwright install chromium` |

`LANG`, `LC_ALL` and `TZ` are pinned to `C`/`UTC` for the comparison, and the PDF is captured at US Letter with zero PDF margin so the sheet is the plan's own. Resolved fonts are recorded for diagnosis only; no product font is changed for parity.

## Invocation policy

`test:exports` does not run in `bun test`, does not run in `bun run test:e2e`, and does not run automatically in CI. Its absence from routine CI is intentional, not a missing gate. Run it when:

- the user explicitly requests export comparison;
- diagnosing a print/DOCX parity problem; or
- reviewing or implementing a diff that affects the Export Document, the Layout Plan, either Export Adapter, pagination, print styling, or supported document-node rendering.

Editor interaction, storage, and other changes outside those branches do not invoke it.

## Fixtures

`src/export-fixtures.ts` holds the corpus: one minimal fixture per supported block, inline mark, link, authored break, list form, table shape, image form, math form, question type and choice-grid setting; boundary cases for a question moving whole to the next page and a question splitting across pages; and a realistic composite.

Every parity bug adds the smallest source fixture that reproduces it. The test must fail before the fix and pass after it.

Fixtures use synthetic content only. A realistic production document belongs in the corpus only after removing student, teacher and school data.

## Failure artifacts

A failed comparison keeps, under `export-artifacts/<fixture>/` (git-ignored):

- `fixture.json` — the source exam;
- `layout-plan.json` — the normalized Layout Plan fingerprint, as planned without browser measurement;
- `print-document.json` — the printed document's fingerprint, as the browser laid it out;
- `export.docx` — the generated package;
- `reference.pdf` — the print Export Adapter's output;
- `export.pdf` — the DOCX rendered by the Comparison Engine;
- `reference-manifest.txt` and `docx-manifest.txt` — the normalized per-page manifests;
- `structural-report.txt` and `page-report.txt` — the comparisons; and
- `../environment.txt` — tool versions, platform, locale and paper size.

These artifacts explain failures; they are not committed golden files.

## Known limits

- **Mathematics is a native equation carrying its LaTeX source.** The DOCX adapter emits a real Office Math object, so Word treats the equation as an equation and it stays editable — but the object's content is the authored LaTeX rather than OMML's own fraction, radical and script structure, because translating LaTeX into OMML needs a parser this codebase does not have. `\frac{a}{b}` therefore appears inside the equation as it was written. The source is preserved and the representation is native; the typesetting is not.
- **The out-of-band comparison cannot adjudicate typeset mathematics or ruled blanks.** Both are excluded from the PDF word comparison for the reasons above; both are asserted structurally in the fast suite.
- **The answer key is print-only.** `createExamDocxDocument` refuses a plan carrying answer-key pages. The Layout Plan already represents the key, so adding the adapter mapping is the whole of the remaining work — but it is separate product work (issue #14 lists it as out of scope).

## Adding a supported document node

The supported set is named once, in `SUPPORTED_NODES` and `SUPPORTED_MARKS` in `src/question-doc.ts`. A newly supported editor node needs all four of these:

1. `doc-view.tsx` — how print draws it.
2. `docx-export.ts` — how Word holds it.
3. `export-fingerprint.ts` — the content line it reduces to, so the plan side has an expectation.
4. `print-fingerprint.ts` — how that line is read back out of print's markup.

Plus a fixture in `export-fixtures.ts`. `export-parity.test.ts` asserts that every name in `SUPPORTED_NODES` and `SUPPORTED_MARKS` appears in a fixture, and that every question type, column setting and page-header variant does too — so a node added to the list without coverage fails rather than disappearing quietly.

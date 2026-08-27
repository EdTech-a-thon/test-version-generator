# crepe-editor

A Vite + React app for authoring multiple-choice questions in a Milkdown/Crepe rich-text editor.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `EdTech-a-thon/test-version-generator`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Export parity

Before comparing or debugging print and DOCX output, or changing export semantics, layout, or adapters, read `docs/export-testing.md`.

`bun test` covers export parity without any system dependency. The heavyweight comparison, `bun run test:exports`, is an out-of-band diagnostic: it needs LibreOffice and Poppler, and it is not part of `bun test`, `bun run test:e2e`, or CI. Run it when the user asks for an export comparison, when diagnosing a print/DOCX parity problem, or when a diff touches the Export Document, the Layout Plan, either Export Adapter, pagination, print styling, or supported document-node rendering.

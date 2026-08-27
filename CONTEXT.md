# Crepe Editor

Crepe Editor authors and publishes versioned exams while preserving the intended structure and layout across output formats.

## Language

**Export Document**:
The format-neutral semantic content and presentation intent for one exam version and content selection.
_Avoid_: Central representation, export model

**Layout Plan**:
The format-neutral resolution of an Export Document into pages, grids, headers, footers, and explicit break decisions.
_Avoid_: Rendered document

**Content Selection**:
Which of an exam version's documents an export covers — the student test, the answer key, or both.
_Avoid_: Print content, mode

**Export Adapter**:
A translator from a Layout Plan into a particular output format, such as print HTML/PDF or DOCX.
_Avoid_: Renderer

**Reference PDF**:
The PDF captured from the print Export Adapter and treated as the layout oracle for export acceptance.
_Avoid_: Golden PDF

**Comparison Engine**:
External software used during testing to render a DOCX into a PDF whose structure and geometry can be compared with the Reference PDF.
_Avoid_: DOCX renderer

**Export Fingerprint**:
The normalized ordered content, page assignment and structural topology of an export, in one vocabulary a Layout Plan and either Export Adapter's output all reduce to. Excludes package bytes, generated identifiers, coordinates and renderer-chosen line wrapping.
_Avoid_: Snapshot, golden

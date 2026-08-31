# Test Parrot

Test Parrot authors and publishes versioned exams while preserving the intended structure and layout across output formats.

## Language

**Question Content**:
The rich-text material authored for one question, including its stem and, when present, its answer choices.
_Avoid_: Question text, editor content

**Authored Image Size**:
The width a teacher assigns to a block image relative to its printable container, such as the Question Content lane or an answer-choice cell. It preserves the image's intrinsic aspect ratio.
_Avoid_: Image ratio, image height

**Version**:
One arrangement of an exam's shared Question Content, defined by question order within each Question Section and answer order within each question. A Version does not own a separate copy of Question Content.
_Avoid_: Exam copy, content copy

**Generated Version**:
A distinct Version created for one export operation and discarded when that operation finishes. Generated Versions are unique within an export and labeled independently from A onward.
_Avoid_: Saved version, persisted version

**Question Section**:
A group of questions of the same type whose boundary remains fixed across Versions, such as Multiple Choice or Short Answer.
_Avoid_: Question category

**Randomization**:
The creation of an additional Generated Version by shuffling enabled order dimensions while preserving Question Content, correct answers, and Question Section boundaries.
_Avoid_: Content shuffle, question mutation

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

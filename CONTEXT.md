# Test Parrot

Test Parrot authors and publishes versioned exams while preserving the intended structure and layout across output formats.

## Language

**Question Content**:
The rich-text material authored for one question, including its stem and, when present, its answer choices.
_Avoid_: Question text, editor content

**Question Bank**:
A collection of Question Content available while authoring an Exam. The current experience pairs one Question Bank with one Exam, without treating that pairing as permanent ownership.
_Avoid_: Question library

**Difficulty**:
An optional classification of a question as easy, medium, or hard.

**Topic**:
An optional, free-form label describing subject matter assessed by a question. A question may have more than one Topic.
_Avoid_: Concept

**Authored Image Size**:
The width a teacher assigns to a block image relative to its printable container, such as the Question Content lane or an answer-choice cell. It preserves the image's intrinsic aspect ratio.
_Avoid_: Image ratio, image height

**Version**:
An immutable, view-only exam artifact created during export, containing the Question Content, question order, and answer order produced at that time. A Version records what was printed or exported, cannot become editable, and may only be re-exported without modification.
_Avoid_: Editable version, saved draft, revision source

**Export Preview**:
A temporary, mutable view of one prospective Version in the Export Stage. An Export Preview is discarded unless export makes it an immutable Version.
_Avoid_: Draft version, saved version

**Export Event**:
An immutable history entry grouping the Versions produced together, along with when and how they were exported.
_Avoid_: Version folder

**Exam Draft**:
The mutable selection and ordering of Question Content that a teacher is preparing for export. An Exam Draft references Question Content in a Question Bank and is not a Version.
_Avoid_: Current version, editable version

**Remove**:
To exclude Question Content from an Exam Draft while leaving it in the Question Bank.

**Replace**:
To put one Question Bank record in another's place at a fixed position in an Exam Draft. Neither question's Question Content is copied or deleted, and the replaced question remains in the Question Bank.
_Avoid_: Swap, substitute

**Delete**:
To permanently remove Question Content from a Question Bank. Deletion is not available from an Exam Draft.

**Short Answer**:
A Question Type whose response is intentionally brief and does not present answer choices.
_Avoid_: Open, Open ended, Open Response, Short Response

**Question Section**:
A group of questions of the same type whose boundary remains fixed across Versions, such as Multiple Choice or Short Answer.
_Avoid_: Question category

**Randomization**:
The creation of a Version during export by shuffling enabled order dimensions while preserving Question Content, correct answers, and Question Section boundaries.
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

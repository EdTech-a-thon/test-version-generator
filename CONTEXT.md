# Test Parrot

Test Parrot authors and publishes versioned exams while preserving the intended structure and layout across output formats.

## Language

**Question Content**:
The rich-text material authored for one question, including its stem and, when present, its answer choices.
_Avoid_: Question text, editor content

**Question Revision**:
An immutable export-time presentation state of one Question Bank record, including its Question Content, correct answer, and answer-column layout. Export reuses an exactly matching revision and creates one only for a previously unseen presentation state; Difficulty and Topics do not distinguish revisions.
_Avoid_: Question copy, historical question

**Question Metadata**:
Difficulty and Topics used to find and Replace Equivalent Questions while composing an Exam Draft. Question Metadata does not affect Question Revision or Version identity.
_Avoid_: Question identity, version metadata

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
An immutable, view-only exam artifact with a stable adjective-noun name, identified by a name-independent Export Fingerprint of its format-neutral semantic content and resolved layout. The same words, media, correctness, formatting, order, and page assignment reuse a Version regardless of Question Metadata, how the state was reached, output format, or Content Selection; every Version retains canonical student-test and answer-key Layout Plans for re-export but never becomes editable itself.
_Avoid_: Editable version, saved draft, revision source

**Version History**:
The append-only collection of immutable Versions previously exported from an Exam Draft. Versions can be viewed and re-exported but not edited or deleted.
_Avoid_: Export log, version folder

**Exam Draft**:
The mutable selection and ordering of current Question Bank records that a teacher is preparing for export. It may be initialized from a historical Version only after every historical Question Revision has been reconciled with the Question Bank.
_Avoid_: Current version, editable version

**Use as Draft**:
To initialize the Exam Draft from a historical Version after Question Reconciliation, without changing the Version.
_Avoid_: Import version, edit version, restore version

**Question Reconciliation**:
The review that resolves source questions against current Question Bank records before they enter the Exam Draft. It chooses complete Question Revisions rather than synthesizing them: an older revision may use the bank's latest state or become a new record, while a historical question not in the Question Bank may become a new record with a fresh identity and its full historical state, or be left out.
_Avoid_: Question migration, conflict resolution

**Remove**:
To exclude Question Content from an Exam Draft while leaving it in the Question Bank.

**Replace**:
To put one Question Bank record in another's place at a fixed position in an Exam Draft, initially using the incoming question's authored answer order. Neither question's Question Content is copied or deleted, and the replaced question remains in the Question Bank.
_Avoid_: Swap, substitute

**Delete**:
To permanently remove Question Content from a Question Bank. Deletion is not available from an Exam Draft.

**Short Answer**:
A Question Type whose response is intentionally brief and does not present answer choices.
_Avoid_: Open, Open ended, Open Response, Short Response

**Question Section**:
A group of questions of the same type whose boundary remains fixed across Versions, such as Multiple Choice or Short Answer.
_Avoid_: Question category

**Equivalent Question**:
A Question Bank record in the same Question Section with the same Difficulty and the same non-empty set of Topics. A missing Difficulty matches only another missing Difficulty; a question without a Topic has no Equivalent Questions.
_Avoid_: Similar question, interchangeable question

**Vary**:
A family of Exam Draft actions that shuffle question order, Replace questions with equivalents, or shuffle answer order before a Version is exported.
_Avoid_: Randomization, version generation

**Export Preview**:
A read-only, output-faithful rendering of the Exam Draft with selection, correctness, and other editor annotations hidden. It is not a separate draft or editing workspace.
_Avoid_: Export workspace, draft version

**Media Asset**:
Immutable image bytes identified by their content rather than by a mutable location. Question Revisions and Versions retain Media Asset references so historical output does not depend on an external or disposable image URL.
_Avoid_: Image URL, cached image

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
The normalized semantic content, page assignment and structural topology that identify a Version and that a Layout Plan and either Export Adapter's output all reduce to. Includes both student test and answer key; excludes the Version name, output format, Content Selection, package bytes, generated identifiers, coordinates, fonts, raster appearance, and renderer-chosen line wrapping.
_Avoid_: Snapshot, golden

# Test Parrot

Test Parrot authors reusable questions, saves Exams, and records what teachers export while preserving the intended structure and layout across output formats.

## Language

**Question**:
A canonical record owned by exactly one Question Bank and referenced live by any number of Exams. One Question identity may occur at most once in an Exam; Duplicate creates a new Question in the original Question Bank.
_Avoid_: Exam question, question copy

**Question Content**:
The rich-text material authored for one question, including its stem and, when present, its answer choices or Suggested Answer.
_Avoid_: Question text, editor content

**Question Metadata**:
Difficulty and Topics used to organize and find Questions while composing an Exam. Question Metadata appears as tags beside each entry in an exported Answer Key, but does not appear on the student test.
_Avoid_: Question identity, export identity

**Question Bank**:
An independently reusable, named collection of canonical Questions whose confirmed changes save immediately. It may carry an optional description, author, and license; a new bank is named “Untitled Question Bank” by default. An Exam may reference Questions from any number of banks, and a bank may contribute Questions to any number of Exams.
_Avoid_: Question library

**Question Bank File**:
A self-contained PDF for sharing one complete Question Bank. Its complete teacher-readable preview is derived from its embedded Question Bank Record, which is the authoritative source for importing a new independent Question Bank.
_Avoid_: Exam export, printable question bank, backup

**Question Bank Record**:
The versioned, format-owned machine-readable representation of one complete Question Bank and every Media Asset it needs. It travels either embedded in a Question Bank File or as a standalone JSON file, and is the authoritative source for import either way. Import creates a new independent Question Bank from this record rather than preserving local identities or inferring Question Content from PDF pages.
_Avoid_: PDF metadata, extracted questions

**Difficulty**:
An optional classification of a question as easy, medium, or hard.

**Topic**:
An optional, free-form label describing subject matter assessed by a question. A question may have more than one Topic.
_Avoid_: Concept

**Authored Image Size**:
The width a teacher assigns to a block image relative to its printable container, such as the Question Content lane or an answer-choice cell. It preserves the image's intrinsic aspect ratio.
_Avoid_: Image ratio, image height

**Exam**:
A mutable composition with a stable identity and a name, made from live references to Question Bank records. A new Exam is named “Untitled Exam” by default; Save updates it, while Save As moves the current Working Copy into a separate Exam and restores the source Exam to its last saved state. An untouched, empty Untitled Exam is disposable rather than durable.
_Avoid_: Exam project, exam family, Version, Draft

**Working Copy**:
The locally backed-up editing state currently open for an Exam. It may differ from the Exam's explicitly saved state and is the state that Save, Save As, and Export act upon.
_Avoid_: Exam Draft, Draft, autosaved Exam, local save

**Export Record**:
An immutable, undeletable record attached to an Exam and created each time its Working Copy or a previous Export Record is exported. It retains only the exact Content Selection, format, question state, and Layout Plans produced by that event; repeated and historical re-exports produce separate Export Records, and export does not save the Exam.
_Avoid_: Version, saved Exam, deduplicated export

**Export Artifact**:
A PDF or DOCX produced by an export and described by its Export Record.
_Avoid_: Version, Exam

**Export History**:
The permanent chronological collection of an Exam's Export Records. Export History preserves what the teacher produced without making the Exam immutable.
_Avoid_: Version History, audit log

**Remove**:
To exclude Question Content from an Exam while leaving it in its Question Bank.

**Replace**:
To put one Question Bank record in another's fixed position in an Exam, using the incoming Question's authored answer order and the outgoing reference's answer-column layout. Neither Question is copied or deleted, and the replaced Question remains in its Question Bank.
_Avoid_: Swap, substitute

**Delete**:
To permanently remove Question Content from its Question Bank, every Exam that references it, and their Working Copies. Deletion requires showing the affected Exams and explicit confirmation; existing Export Records remain unchanged.

**Short Answer**:
A Question Type whose response is intentionally brief and does not present answer choices.
_Avoid_: Open, Open ended, Open Response, Short Response

**Suggested Answer**:
Optional rich-text material authored for a Short Answer question to represent its answer in the Answer Key.
_Avoid_: Correct answer, sample response, rubric

**Question Section**:
A group of questions of the same type whose boundary remains fixed within an Exam and its exported output, such as Multiple Choice or Short Answer.
_Avoid_: Question category

**Vary**:
A family of Exam actions that shuffle question order or answer order before saving or exporting.
_Avoid_: Randomization, version generation

**Export Preview**:
A read-only, output-faithful rendering of the Working Copy with selection, correctness, and other editor annotations hidden. It is not a separate draft or editing workspace.
_Avoid_: Export workspace, draft version

**Media Asset**:
Immutable image bytes identified by their content rather than by a mutable location. Export Records retain Media Asset references so recorded output does not depend on an external or disposable image URL.
_Avoid_: Image URL, cached image

**Export Document**:
The format-neutral semantic content and presentation intent for one Exam export and Content Selection.
_Avoid_: Central representation, export model

**Layout Plan**:
The format-neutral resolution of an Export Document into pages, grids, headers, footers, and explicit break decisions.
_Avoid_: Rendered document

**Content Selection**:
Which documents an export covers — the student test, the answer key, or both.
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
The normalized semantic content, page assignment, and structural topology used to compare an Export Document, its Layout Plan, and each Export Adapter's output. It excludes output format, package bytes, generated identifiers, coordinates, fonts, raster appearance, and renderer-chosen line wrapping.
_Avoid_: Version identity, snapshot, golden

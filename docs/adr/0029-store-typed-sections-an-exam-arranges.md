---
status: accepted
---

# Store typed Sections that an Exam arranges

A Question Section used to be derived from Question Type and never stored: an Exam had at most one Section per type, always in the same order, and ADR-0025 keyed each Section's wording by its type. Teachers wanted more than one Section of the same kind, such as two Multiple Choice Sections with their own headings, and wanted to arrange Sections themselves.

A Section is therefore stored in the Exam. It has a type, a Section Heading, Section Directions and an ordered list of Questions. It stays typed and exclusive. Untyped Sections, holding any mix of Questions under a heading taken from the first Question dropped in, were considered and rejected: the directions a student reads only fit when every Question beneath them is answered the same way, and a Section's type is what makes its default wording correct. An Exam may hold several Sections of one type, in any order. Every Question belongs to exactly one Section, and question numbering still runs continuously across the whole Exam.

ADR-0025's wording rules now apply to each Section rather than each type. A Section begins with its type's default heading and directions. Only a part the teacher changes is stored, and an empty string is a part they cleared, which prints nothing.

A Section is created only by putting a Question somewhere no existing Section can take it:

- The first Question added to an empty Exam creates a Section.
- Add, and each Question in Add all, goes to the last Section of its type in Exam order. When there is none, it creates a new Section of that type at the end.
- While a drag's drop line reaches a Section's last Question, a "create new section" target slides open beneath it. It opens rather than appearing instantly, so the sheet does not jump under the pointer. Dropping there creates one Section per dragged type directly below.

A drag never splits a Section, and a Question is never offered a place inside a Section of another type.

A Section is removed only on purpose. An emptied Section stays on the sheet, where it can take another Question, but is omitted from the student test and the Answer Key, as an empty Section always was. Automatic removal was rejected because dragging the last Question out of a Section and then dragging a new one in is ordinary editing and should not destroy the Section's wording. Each Section has up and down arrows to move it past a neighbour, and a delete button that Removes its Questions. Both can be undone, so deleting asks for no confirmation.

Replace is withdrawn. It existed so that a Question could take another's position without crossing a Section boundary. Dragging now only inserts, and this supersedes ADR-0011's manual Replace. Vary and export Versions (ADR-0028) shuffle Questions only within their own Section. The Answer Key groups its entries by Section.

The answer blank that printed before each Multiple Choice and True/False number is removed from the sheet, print and DOCX, and every Question gets the narrow number column Short Answer already used. The Question lane widens by the difference. A student now circles a Multiple Choice letter. A True/False Question prints a T and an F beside its number to circle, which supersedes ADR-0020's "the pair is not printed". Matching Items keep their blanks, because a Matching answer is a letter the student writes.

Existing Exams, Working Copies and Exam Records migrate into one Section per non-empty type, in the old fixed order, carrying each type's stored wording. Nothing on the printed page moves. Export Records are unchanged. The Exam Record gains a minor version, and Test Parrot keeps reading older records by deriving their Sections the old way.

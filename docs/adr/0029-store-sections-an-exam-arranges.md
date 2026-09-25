---
status: accepted
---

# Store Sections that an Exam arranges

A Question Section used to be derived from Question Type and never stored. An Exam had at most one Section per type, always in the same order, and ADR-0025 keyed each Section's wording by its type. Teachers wanted to arrange Sections themselves: two parts of Multiple Choice with their own headings, say, or a warm-up that mixes kinds of question.

A Section is therefore stored in the Exam. It has a Section Heading, Section Directions and an ordered list of Questions of any type. Every Question belongs to exactly one Section, and question numbering still runs continuously across the whole Exam.

We first built Sections typed and exclusive: each held one type, and an Exam could have several Sections of a type. After using it, we dropped the type. It added rules a teacher had to learn, such as where a question may not go and why a drop was refused, and it bought very little. A Section's type only decided its default wording, and a teacher who mixes types writes their own directions anyway. So a Section is just a Section. Its heading and directions begin as those of the type of the first Question put in it, and from then on they are the teacher's own text. An empty string is a part the teacher cleared, which prints nothing.

A Section is created only by putting a Question somewhere no existing Section is:

- The first Question added to an empty Exam creates a Section.
- Add, and Add all, go to the end of the last Section.
- While a drag's drop line reaches a Section's last Question, a "create new section" target slides open beneath it. Dropping there creates one Section directly below. The target opens rather than appearing instantly, and it is drawn over the sheet rather than in its flow, so nothing on the paper moves under the pointer.

A Section is removed only on purpose. An emptied Section stays on the sheet, where it can take another Question, but it is left out of the student test and the Answer Key. Automatic removal was rejected because dragging the last Question out of a Section and then dragging a new one in is ordinary editing, and it should not destroy the Section's wording. Each Section has up and down arrows and a delete button in the left page margin, beside its heading. Delete Removes the Section's Questions. It can be undone, so it asks for no confirmation. Pointing at a heading highlights the whole Section. On the sheet only, a dotted rule marks where each Section begins, drawn without changing the layout.

Replace is withdrawn. It existed so that a Question could take another's position without crossing a Section boundary. Dragging now only inserts, and this supersedes ADR-0011's manual Replace. Vary and export Versions (ADR-0028) shuffle Questions only within their own Section. The Answer Key groups its entries by Section; a Section whose heading is cleared is named by its place ("Section 2").

The answer blank that printed before each Multiple Choice and True/False number is removed from the sheet, print and DOCX, and every Question gets the narrow number column Short Answer already used. The Question lane widens by the difference. A student now circles a Multiple Choice letter. A True/False Question prints a T and an F beside its number to circle, which supersedes ADR-0020's "the pair is not printed". Matching Items keep their blanks, because a Matching answer is a letter the student writes.

An Exam written before Sections were stored reads as one Section per non-empty type, in the old fixed order, carrying each type's stored wording. Its first structural edit stores those Sections, so nothing on the printed page moves. Export Records are unchanged. Exam Record 0.3.0 carries the Sections, empty ones included, and each position's Section. Test Parrot keeps reading 0.1.0 and 0.2.0 records by deriving their Sections the old way.

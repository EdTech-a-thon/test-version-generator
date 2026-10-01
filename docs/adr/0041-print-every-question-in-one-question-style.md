---
status: accepted
---

# Print every question in one Question Style

Teachers coming from other tools expect their tests to look the way those tools print them: an answer blank before each number in ExamView, a write-on blank for "true" or "false" on a publisher's worksheet, or as many questions to a page as will fit. Since ADR-0029 Test Parrot printed one look only: a Multiple Choice letter circled on its answer, T and F circled beside a True/False number, and no blanks before numbers.

An Exam now has one **Question Style**, chosen from the Format menu's Questions submenu, which shows the current style and offers four, each with a line saying what it does. It is presentation like the heading and text sizes (ADR-0025): stored on the Exam, saved and undone with it, and reflowing the sheet as soon as it changes. A style per question or per Question Type was considered and left out until a teacher asks: the request was for a test that looks like the ones they know, and a per-Exam setting can gain finer ones later without changing what an Exam stores.

| Style | Before a number | Answers | Word Bank | Short Answer with no Work Space | Spacing |
| --- | --- | --- | --- | --- | --- |
| Standard | T and F to circle on True/False; nothing on Multiple Choice | `A.`, in the question's columns | beside its Items up to five, above past that | no room | the sheet's own |
| ExamView | an answer blank on Multiple Choice and True/False | `a.`, in the question's columns | lettered `a.`, above its Items | three ruled lines | the sheet's own |
| Condensed | as Standard | `A.`, across the line where they fit | as Standard | no room | closer together |
| Worksheet | a long blank on True/False, a short one on Multiple Choice | `a.`, in the question's columns | lettered `a.`, beside its Items | two ruled lines | the sheet's own |

- **Standard** is the sheet as it printed before, and the default; an Exam that never chose a style stores nothing and prints exactly as it did.
- **ExamView** follows ExamView Test Generator's printed defaults as its v11 user guide describes them (Layout preferences, p. 173; matching groups, pp. 22–23): an answer space before each objective question's number ("____ 1."), space below open-ended questions with answer lines, True/False printed without answer choices unless asked for, and a matching group's choices lettered a–z and listed after its instructions, above its numbered questions. The guide does not say how many answer lines ExamView rules or which letter style is its default; three lines and "a." are our reading of its printed samples.
- **Worksheet** follows the publisher study guide: a long blank to write the word on, a short one to write a letter on, and Column B beside the Items, however long.
- **Condensed** saves paper: nothing added, questions closer together, and Multiple Choice answers laid across the line in four, or else two, columns wherever every answer fits one line of a column. How wide an answer is, is a measurement, so it is decided with the pagination, by the same injected `Measure`; an answer holding a picture or a table keeps its columns.

Every Matching Item keeps its blank under every style, Condensed included: it is where a Matching answer is written, not an addition. A Multiple Choice Part keeps its capital letters under every style, so they never read as the lower-case Part letters beside them. A style never lays answers out in fewer columns than the teacher set; ExamView and Worksheet print "stacked or in the question's columns" by keeping the teacher's own setting, which is one column unless they chose more.

The style is resolved where every other content decision is, in the Export Document (ADR-0001): the planned question carries what prints before its number, the grid and Word Bank carry the letters as the test prints them, and the work space is the one the style resolves. So print, PDF, DOCX, the Export Preview and the sheet draw the same thing without each knowing the styles, and packing measures what they draw. The only thing an adapter reads from the style is how far apart questions stand, which the Layout Plan names beside its text size. The answer blank is the same seven underscores, in the same wider number column, that an Export Record from before Sections printed, so those records reprint through the same path.

The Answer Key does not change with the style. Its letters stay capitals, as ExamView's own key reads "ANS: A" beside a test lettered "a."; the question keeps its capitals for the key while its grid prints the style's letters.

## Work Space

The style supplies the room a Short Answer question or Short Answer Part leaves only where the teacher has set none. A Work Space the teacher set always wins, "None" included. Choosing None used to delete the position's setting, since no room and no setting printed alike; under a style that rules lines that is no longer true, so None is then stored as a zero-height Work Space, and it keeps meaning none whatever style the Exam later takes. Switching style never touches a stored Work Space. The sheet's Work Space menu and handle start from what the position prints, so a position showing a style's lines shows Lined space checked.

## Records

An Export Record keeps its Layout Plans, which carry everything the style decided, so a historical re-export reproduces it with no further change. The Exam Record carries the style as `questionStyle`, absent meaning Standard, so it travels in a Test Parrot Package. Adding a member a 0.3.0 consumer would drop is a minor version: Exam Record `0.4.0` is published beside `0.3.0`, carrying `questionStyle` alongside the Page Margins (ADR-0039). Test Parrot writes `0.4.0` and reads every earlier version as an Exam in the Standard style. Only a Work Space the teacher set is written into a position, a zero-height one included where the style would rule lines; the room a style rules is the style's, and travels as `questionStyle`.

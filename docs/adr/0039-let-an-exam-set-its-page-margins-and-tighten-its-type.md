---
status: accepted
---

# Let an Exam set its page margins, and tighten its type

Teachers asked for tighter line spacing, smaller margins, and Multiple Choice answers set in a little from their question. Every line of question text was 1.45 lines apart, every paragraph opened a full line's gap, and every bulleted item opened that same gap, so a paragraph break could not be told from the next line and a short list sprawled down the page.

## Spacing

The body's spacing is one table in `export-typography.ts`, in multiples of the type's size so every text size keeps its proportions, and every adapter reads it:

- A line is `BODY_LINE_HEIGHT` (1.3, was 1.45) times the type.
- A paragraph, or a list, opens `PARAGRAPH_GAP_EM` (1em) below the block before it — print's own paragraph spacing, now stated rather than left to the browser. The gap is unchanged; against the tighter lines it now reads as a break.
- A list's items sit `LIST_ITEM_GAP_EM` (0.2em) apart, where each used to open a paragraph gap, and an item's own paragraphs sit together.

Print sets these on `.exam-page` and its question text, and the measuring host inherits them, so the plan packs what print draws. The PDF draws its line pitch and gaps from the same numbers. DOCX gives each body paragraph a line height of at least the table's — at least, so a line holding a picture or an equation still grows — and the same gaps. Choices and Matching items keep their own tight spacing, as before.

A Multiple Choice question's answers, and a Multiple Choice Part's, are set in `CHOICE_INDENT` (18px) from the stem above them, in all three adapters.

Export Records keep their Layout Plans, and an adapter draws a recorded plan with today's spacing. Tighter lines only leave a reprinted page more room at its foot; the narrower answers could, rarely, wrap a long answer in a four-column grid onto another line.

## Page Margins

Margins are this Exam's presentation, like its heading and text sizes (ADR-0025): set from the Format menu, saved and undone with the Exam. They are in inches, the unit a teacher sets them in, from 0.5 to 1.5 in steps of 0.05; ¾ inch on every side, the sheet's margin until now, is the default, and only a departure from it is stored, so no Exam already made moves.

The control is shaped like a design tool's corner radius: one slider and field set all four sides, and a toggle opens Top, Right, Bottom and Left. When the sides differ the combined field reads "Mixed", and moving the combined slider sets every side to where it lands. It is a panel the Format menu opens rather than rows in the menu, because a menu closes on any scroll and a sheet that loses a page as its margins shrink scrolls under the pointer mid-drag. The sheet reflows as the value changes, and one drag of a slider is one undo step.

The Layout Plan's `pageSize` carries each side's margin in pixels and the content width they leave. Packing measures every item at that width and fills the height the top and bottom leave; print lays the sheet out from the plan's own page size; the PDF and DOCX cut each page to it. A plan recorded before this states one `margin` for every side, and reads as that margin on all four, so an Export Record reprints as it did and a new one reprints with its own margins.

The Exam Record carries them as `margins`, every side stated, so they travel in a Test Parrot Package. Adding a member a `0.3.0` consumer would drop is a minor version: Exam Record `0.4.0` adds `margins` to `0.3.0` and nothing else. Test Parrot writes `0.4.0` and reads every earlier version with the default margins.

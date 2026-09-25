---
status: accepted
---

# Pop the Question Bank over other windows

Teachers write tests in Google Docs as well as in Test Parrot, and want the Questions they have banked while they do. The Question Bank Pop-over is a compact view of Question Banks that stays on top of the document being written: a search, the bank's filters, a scrolling list of small Question cards, and one gesture — clicking a card — that Copies that Question for pasting. It opens from a bank card's menu and from the Question Bank page's own actions, and holds banks as tabs the way the Exam editor's pane does, with its own "+" to open another. Its tabs and their filters are remembered under a workspace of their own, keyed by nothing: the Pop-over belongs to no Exam, and opening it from a bank adds that bank's tab or switches to it.

It is a Document Picture-in-Picture window rather than an ordinary popup. An ordinary window goes behind the document the moment the teacher clicks into it, which is the one thing the Pop-over exists not to do. Picture-in-Picture is Chrome's, so both ways in are hidden where the browser does not offer it rather than shown and failing. Its document is a view the opening tab renders into, which means it closes when that tab's document goes away; so moving between Home, the collections, a Question Bank page and an Exam's editor is an in-page navigation, never a document load, and the Pop-over is rendered at the application's root rather than by any one page. It reads its banks again whenever it takes focus, which is how an edit made in the tab behind it arrives.

It is read-only. Editing, adding to an Exam and Delete stay on the surfaces that already own them, and nothing on the Pop-over enters authoring history or updates a bank.

Copy is student-facing: the stem, then lettered answers, a Word Bank and blank-led Items, or lettered Parts, unnumbered so the destination numbers them, and never correctness, a Suggested Answer, Question Metadata or Work Space. Copying the answer by accident is worse than looking it up. The clipboard gets rich text and plain text. Pictures travel inside the rich text as their own bytes, because a Media Asset's local address means nothing outside this browser, at their Authored Image Size against a 6.5-inch column; mathematics travels as a picture of itself rendered by MathJax, because no word processor reads KaTeX's markup and LaTeX source is not something to hand a student. The same Copy is offered beside Edit wherever a bank's Questions are listed.

This amends ADR-0013 only in its last paragraph's claim that a bank's one address is its page: the Pop-over is a second, compact way to see a bank, with no address of its own.

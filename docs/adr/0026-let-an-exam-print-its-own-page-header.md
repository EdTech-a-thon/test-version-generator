---
status: accepted
---

# Let an Exam print its own page header

Every test page printed a fixed header: Name, Class and Date blanks on the first page, a Name blank on later pages, and the paper's ID on each. Teachers asked to make it say whatever they want — a school's name, a logo, a score box — and to edit it the way they edit a header in a word processor.

The header is rich text, not a list of labelled blanks. Blanks were considered and set aside: they cover a fixed vocabulary, and the request was for anything. It is edited with the question editor, Crepe, cut down to text, tables and images, opened by a double-click on a test page's header. A small bar above it says a header is being edited and holds what only a header has: the paper's ID, a first page of its own, table borders, and removing it.

The header belongs to one Exam (`Exam.header`). The default is not stored: an Exam that has never edited its header prints through the original identity-line furniture, byte for byte as before, and the first edit starts from the default written out as content — a borderless table of blanks ending in the ID. So an untouched Exam and every existing export are unchanged, and nothing is migrated.

The ID is the one live value, an inline `exam_id` node. The plan resolves it to the paper's ID ("ID: A") when it builds the Export Document, so print, PDF and DOCX draw plain text and none of them knows the node exists. A header table prints without borders unless the teacher turns them on — a table in a header is almost always layout — and the plan marks it `borderless`, the one table attribute the adapters read, turning its editor-imposed heading row into an ordinary one. The header editor extends GFM's table with that `borders` attribute and lets a header table be a single row; Question Content keeps GFM's table unchanged.

Height is measured, not fixed. The Layout Plan measures each header once, through the same `Measure` that measures page items, caps it at a quarter of the page's content box, and packs every page against the height its header actually takes; the title keeps its own line under the first page's header. Print clips the header to that height and the PDF clips its drawing to the same band, so a header drawn a little taller by one adapter's metrics never runs into the questions. The editor warns when a header passes the cap rather than letting it be clipped unseen. Answer Key pages keep their own header.

The header travels in the Exam Record, `0.2.0`, in the Question Bank Record's document vocabulary with its images in the record's own `media`, so a package carries it whole and its images are written with the rest of the package's media on import.

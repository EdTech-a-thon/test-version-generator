---
status: accepted
---

# Tag figures drawn with lines

ADR-0027 tagged only embedded images, and sent every picture drawn with lines to a page crop. A teacher who saved an AP Classroom test from Chrome found 11 of its 24 figures untagged: Chrome keeps each SVG graph or structure as the paths it drew, so the PDF has no image for it. She took the missing tags for a fault, and each one meant a crop by hand.

A PDF does not say where such a figure is, so Test Parrot finds it from the ink. Paths that overlap or nearly touch are one drawing, including a path that only clips, since a browser clips each SVG to its own frame and that frame holds its labels. A drawing is a figure when it is picture-sized by the same rule as an image, has at least ten curves, and lies over no embedded image. The curves are what tell a graph or a molecule from a table or a box, which are straight lines: on that test the tables had none and every figure had hundreds. Short text on a figure, such as tick labels and then the axis title past them, is taken into its box; a line of the question running past it is not. A figure gets an Image Tag in reading order with the images on its page, and its labeled copy is marked the same way.

The picture a drawn figure's tag names is its region of the page rendered at print resolution, not bytes from the original, since there are none. That relaxes ADR-0027's rule that a tag's picture is the document's own image; it is still a pure function of the PDF's bytes, so the same PDF gets the same tags.

The rule is a heuristic. A figure of straight lines only, such as a bar chart, is not tagged and is still written as a page and cropped, and a table with many rounded corners could be tagged as a figure, which the assistant then transcribes as it would a table stored as an image.

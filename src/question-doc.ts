// The ProseMirror document that holds a question's stem and, for multiple
// choice, its choice nodes. Questions are stored as plain JSON so the model and
// the store never need a live editor; only the Crepe dialog turns it back into
// a ProseMirror document.

export type ProseMirrorJSON = Record<string, unknown>

export const emptyDoc: ProseMirrorJSON = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

function blankChoice(): ProseMirrorJSON {
  return {
    type: 'multipleChoiceChoice',
    attrs: { correct: false, id: '' },
    content: [{ type: 'paragraph' }],
  }
}

// Strip a document down to the shapes the editor schema accepts, so a document
// that has been round-tripped through storage always loads. Choices keep their
// stable id and their boolean `correct`; a choice list is never left with fewer
// than the two answers the schema requires.
export function cleanDocument(value: ProseMirrorJSON): ProseMirrorJSON {
  const cleanNode = (node: ProseMirrorJSON): ProseMirrorJSON => {
    const clean: ProseMirrorJSON = { type: String(node.type ?? 'paragraph') }
    if (typeof node.text === 'string') clean.text = node.text
    if (Array.isArray(node.marks)) {
      clean.marks = node.marks.map((mark) => ({
        type: String((mark as { type?: unknown }).type ?? ''),
      }))
    }
    if (Array.isArray(node.content)) {
      clean.content = node.content.map((child) =>
        cleanNode(child as ProseMirrorJSON),
      )
    }
    if (node.type === 'multipleChoice') {
      const choices = Array.isArray(clean.content)
        ? (clean.content as ProseMirrorJSON[])
        : []
      while (choices.length < 2) choices.push(blankChoice())
      clean.content = choices
    } else if (node.type === 'multipleChoiceChoice') {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>
      clean.attrs = {
        correct: attrs.correct === true,
        id: typeof attrs.id === 'string' ? attrs.id : '',
      }
    }
    return clean
  }
  return cleanNode(value)
}

function childrenOf(node: ProseMirrorJSON): ProseMirrorJSON[] {
  return Array.isArray(node.content) ? (node.content as ProseMirrorJSON[]) : []
}

// The `multipleChoice` node of a question document, or undefined when the
// question carries no answers. A document holds at most one.
export function multipleChoiceNodeOf(
  doc: ProseMirrorJSON,
): ProseMirrorJSON | undefined {
  return childrenOf(doc).find((node) => node.type === 'multipleChoice')
}

// The answers of a question document in authoring order — the order a version's
// `choiceOrder` permutes.
export function choiceNodesOf(doc: ProseMirrorJSON): ProseMirrorJSON[] {
  const list = multipleChoiceNodeOf(doc)
  if (!list) return []
  return childrenOf(list).filter((node) => node.type === 'multipleChoiceChoice')
}

export function choiceIdOf(node: ProseMirrorJSON): string {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  return typeof attrs.id === 'string' ? attrs.id : ''
}

export function choiceIsCorrect(node: ProseMirrorJSON): boolean {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  return attrs.correct === true
}

// Export parity, at the seam that matters.
//
// One Layout Plan per fixture, fed to both Export Adapters, with each adapter's
// observable result reduced to the same content lines and compared against the
// plan. A difference here means one output says something the other does not —
// which is the entire class of bug this suite exists to catch.
//
// These tests need no LibreOffice, no Chromium and no PDF tooling. The
// heavyweight comparison in `bun run test:exports` is a separate, out-of-band
// diagnostic; see `docs/export-testing.md`.

import { describe, expect, test } from 'bun:test'
import { createExamDocx, type MediaLoader } from './docx-export'
import { docxFingerprint } from './docx-fingerprint'
import { FIXTURES, PIXEL_PNG, type Fixture } from './export-fixtures'
import {
  compareFingerprints,
  describeDifferences,
  exportDocumentFingerprint,
  layoutPlanFingerprint,
  type ExportFingerprint,
} from './export-fingerprint'
import {
  buildExportDocument,
  planExport,
  unmeasured,
  STUDENT_TEST,
  type LayoutPlan,
} from './export-plan'
import { printFingerprint } from './print-fingerprint'
import {
  SUPPORTED_MARKS,
  SUPPORTED_NODES,
  type ProseMirrorJSON,
} from './question-doc'

const noImages: MediaLoader = async () => null
const pixel: MediaLoader = async () => PIXEL_PNG

/** The whole document a fixture describes: the test, and the key where the
 *  fixture asks for one. What print produces. */
function planOf(fixture: Fixture) {
  return planExport({
    exam: fixture.exam,
    version: fixture.version,
    selection: { test: true, answerKey: fixture.answerKey ?? false },
    measure: fixture.measure,
  })
}

/** The student test alone — the selection DOCX export covers. */
function studentPlanOf(fixture: Fixture) {
  return planExport({
    exam: fixture.exam,
    version: fixture.version,
    selection: STUDENT_TEST,
    measure: fixture.measure,
  })
}

async function docxOf(fixture: Fixture): Promise<ExportFingerprint> {
  const blob = await createExamDocx(
    studentPlanOf(fixture),
    fixture.images ? pixel : noImages,
  )
  return docxFingerprint(await blob.arrayBuffer())
}

function expectSameDocument(
  expected: ExportFingerprint,
  actual: ExportFingerprint,
): void {
  expect(describeDifferences(compareFingerprints(expected, actual))).toBe(
    'no differences',
  )
}

describe('the DOCX Export Adapter carries the planned document', () => {
  for (const fixture of FIXTURES) {
    test(fixture.name, async () => {
      expectSameDocument(
        layoutPlanFingerprint(studentPlanOf(fixture)),
        await docxOf(fixture),
      )
    })
  }

  test('refuses a plan carrying an answer key, which is print-only', async () => {
    const fixture = FIXTURES.find((item) => item.answerKey)!
    expect(planOf(fixture).pages.some((page) => page.stream === 'answer-key')).toBe(true)
    await expect(createExamDocx(planOf(fixture), noImages)).rejects.toThrow(
      /answer key is print-only/,
    )
  })
})

describe('the print Export Adapter carries the planned document', () => {
  for (const fixture of FIXTURES) {
    test(fixture.name, () => {
      const plan = planOf(fixture)
      expectSameDocument(layoutPlanFingerprint(plan), printFingerprint(plan))
    })
  }
})

describe('the two Export Adapters agree', () => {
  for (const fixture of FIXTURES) {
    test(fixture.name, async () => {
      // Compared over the selection both cover: the student test.
      expectSameDocument(
        printFingerprint(studentPlanOf(fixture)),
        await docxOf(fixture),
      )
    })
  }
})

// ---------------------------------------------------------------------------
// Exhaustive coverage
//
// A supported node with no fixture is a node whose export nobody is checking.

describe('the supported document vocabulary', () => {
  function nodeTypesIn(node: ProseMirrorJSON, found: Set<string>): Set<string> {
    found.add(String(node.type ?? ''))
    for (const mark of Array.isArray(node.marks) ? (node.marks as ProseMirrorJSON[]) : []) {
      found.add(String(mark.type ?? ''))
    }
    for (const child of Array.isArray(node.content)
      ? (node.content as ProseMirrorJSON[])
      : []) {
      nodeTypesIn(child, found)
    }
    return found
  }

  const covered = FIXTURES.reduce((found, fixture) => {
    for (const question of fixture.exam.questions) nodeTypesIn(question.doc, found)
    return found
  }, new Set<string>())

  test('every supported node appears in a fixture', () => {
    expect(SUPPORTED_NODES.filter((node) => !covered.has(node))).toEqual([])
  })

  test('every supported mark appears in a fixture', () => {
    expect(SUPPORTED_MARKS.filter((mark) => !covered.has(mark))).toEqual([])
  })

  test('every question type and column setting appears in a fixture', () => {
    const columns = new Set(
      FIXTURES.flatMap((fixture) =>
        fixture.exam.questions.map((question) => question.columns),
      ),
    )
    expect([...columns].map(String).sort()).toEqual(['1', '2', '4', 'auto'])
    const types = new Set(
      FIXTURES.flatMap((fixture) =>
        fixture.exam.questions.map((question) => question.type),
      ),
    )
    expect([...types].sort()).toEqual(['multiple-choice', 'open'])
  })

  test('every page-header variant appears in a fixture', () => {
    const headers = new Set(
      FIXTURES.flatMap((fixture) => planOf(fixture).pages.map((page) => page.header)),
    )
    expect([...headers].sort()).toEqual([
      'answer-key',
      'first',
      'later',
    ])
  })
})

// ---------------------------------------------------------------------------
// The semantic stage on its own

describe('the Export Document', () => {
  const [composite] = FIXTURES.filter((item) => item.name.includes('composite'))

  test('derives both documents from one exam version', () => {
    const document = buildExportDocument(
      composite!.exam,
      composite!.version,
      STUDENT_TEST,
      unmeasured,
    )
    const fingerprint = exportDocumentFingerprint(document)
    expect(fingerprint.title).toBe('Chemistry: Unit 3 Review')
    expect(fingerprint.version).toBe('A')
    // The key is derived from the same numbered, lettered questions the test
    // shows, so it can never name a letter the paper does not.
    expect(fingerprint.answerKey).toEqual([
      'heading:1 Answer Section',
      'heading:2 Multiple Choice',
      'para 1. «strong»A«/»',
      'para 2. «strong»A«/»',
      'heading:2 Short Answer',
      'para 3.',
    ])
  })

  test('is derived whole whichever documents the selection asks for', () => {
    const both = buildExportDocument(
      composite!.exam,
      composite!.version,
      { test: true, answerKey: true },
      unmeasured,
    )
    const testOnly = buildExportDocument(
      composite!.exam,
      composite!.version,
      STUDENT_TEST,
      unmeasured,
    )
    expect(exportDocumentFingerprint(testOnly).answerKey).toEqual(
      exportDocumentFingerprint(both).answerKey,
    )
  })

  test('omits a section that holds no questions', () => {
    const document = buildExportDocument(
      { title: 'One section', questions: composite!.exam.questions.slice(0, 1) },
      composite!.version,
      STUDENT_TEST,
      unmeasured,
    )
    const lines = exportDocumentFingerprint(document).test
    expect(lines.filter((line) => line.startsWith('heading:1'))).toEqual([
      'heading:1 Multiple Choice',
    ])
  })
})

// ---------------------------------------------------------------------------
// Proving the comparison
//
// A harness that cannot fail proves nothing. Each of these degrades a real
// fingerprint the way the DOCX path used to differ from print, and asserts that
// the comparison names the discrepancy rather than passing it.

function degrade(
  fingerprint: ExportFingerprint,
  change: (lines: string[]) => string[],
): ExportFingerprint {
  return {
    ...fingerprint,
    pages: fingerprint.pages.map((page) => ({ ...page, content: change(page.content) })),
  }
}

describe('the comparison detects the discrepancies it exists for', () => {
  const gridFixture = FIXTURES.find((item) => item.name.includes('four-column'))!
  const imageFixture = FIXTURES.find((item) => item.name.includes('images'))!
  const mathFixture = FIXTURES.find((item) => item.name.includes('mathematics'))!
  const tableFixture = FIXTURES.find((item) => item.name.includes('table with a header'))!

  test('a choice grid collapsed into paragraphs', () => {
    const expected = layoutPlanFingerprint(planOf(gridFixture))
    const collapsed = degrade(expected, (lines) =>
      lines.filter(
        (line) =>
          !line.startsWith('table:')
          && !line.startsWith('cell:')
          && line !== '/table',
      ),
    )
    const differences = compareFingerprints(expected, collapsed)
    expect(differences).not.toEqual([])
    expect(differences[0]!.what).toBe('content')
    expect(differences[0]!.expected).toBe('table:1x4')
  })

  test('an image replaced by placeholder text', () => {
    const expected = layoutPlanFingerprint(planOf(imageFixture))
    const placeholders = {
      ...degrade(expected, (lines) =>
        lines.map((line) => line.replace(/⟨image:\d+⟩/g, '[Image: burner]')),
      ),
      media: [],
    }
    const differences = compareFingerprints(expected, placeholders)
    expect(differences.map((difference) => difference.what)).toContain('content')
    expect(differences.map((difference) => difference.what)).toContain('media')
  })

  test('mathematics exported as raw source text', () => {
    const expected = layoutPlanFingerprint(planOf(mathFixture))
    const raw = degrade(expected, (lines) =>
      lines.map((line) => line.replace(/⟨math:([^⟩]*)⟩/g, '$1')),
    )
    const [difference] = compareFingerprints(expected, raw)
    expect(difference?.what).toBe('content')
    expect(difference?.expected).toContain('⟨math:E = mc^2⟩')
  })

  test('a table flattened into tab-separated paragraphs', () => {
    const expected = layoutPlanFingerprint(planOf(tableFixture))
    const flattened = degrade(expected, (lines) =>
      lines.flatMap((line) =>
        line.startsWith('table:') || line.startsWith('cell:') || line === '/table'
          ? []
          : [line],
      ),
    )
    const [difference] = compareFingerprints(expected, flattened)
    expect(difference?.what).toBe('content')
    expect(difference?.expected).toBe('table:3x2')
  })

  test('page furniture dropped', () => {
    const expected = layoutPlanFingerprint(planOf(FIXTURES[0]!))
    const bare: ExportFingerprint = {
      ...expected,
      pages: expected.pages.map((page) => ({ ...page, header: [], footer: [] })),
    }
    const kinds = compareFingerprints(expected, bare).map((item) => item.what)
    expect(kinds).toContain('header')
    expect(kinds).toContain('footer')
  })

  test('content moved to another page', () => {
    const fixture = FIXTURES.find((item) => item.name.includes('moves whole'))!
    const expected = layoutPlanFingerprint(planOf(fixture))
    expect(expected.pages.length).toBe(2)
    const moved: ExportFingerprint = {
      ...expected,
      pages: [
        { ...expected.pages[0]!, content: [...expected.pages[0]!.content, 'para 2. Second question.'] },
        { ...expected.pages[1]!, content: [] },
      ],
    }
    const differences = compareFingerprints(expected, moved)
    expect(differences[0]!.page).toBe(1)
    expect(differences[0]!.what).toBe('content')
  })

  // The tests above degrade a fingerprint by hand, which proves the comparison.
  // This one degrades the *plan* and then runs the real adapter over it, which
  // proves the harness: a DOCX built from a collapsed grid is a DOCX the
  // comparison rejects.
  test('a real DOCX built from a collapsed choice grid', async () => {
    const fixture = FIXTURES.find((item) => item.name.includes('four-column'))!
    const plan = studentPlanOf(fixture)
    const collapsed: LayoutPlan = {
      ...plan,
      pages: plan.pages.map((page) => ({
        ...page,
        items: page.items.map((item) =>
          item.kind === 'question' && item.grid
            ? // What the old DOCX path did: the answers become paragraphs and
              // the grid's topology is gone.
              {
                ...item,
                grid: null,
                stem: [
                  ...item.stem,
                  ...item.question.choices.map((choice) => ({
                    type: 'paragraph',
                    content: [{ type: 'text', text: `${choice.letter}. ` }],
                  })),
                ],
              }
            : item,
        ),
      })),
    }
    const blob = await createExamDocx(collapsed, noImages)
    const differences = compareFingerprints(
      layoutPlanFingerprint(plan),
      await docxFingerprint(await blob.arrayBuffer()),
    )
    expect(differences).not.toEqual([])
    expect(differences[0]!.what).toBe('content')
    expect(differences[0]!.expected).toBe('table:1x4')
  })

  test('a page lost altogether', () => {
    const fixture = FIXTURES.find((item) => item.name.includes('split across pages'))!
    const expected = layoutPlanFingerprint(planOf(fixture))
    expect(expected.pages.length).toBeGreaterThan(1)
    const short: ExportFingerprint = { ...expected, pages: expected.pages.slice(0, 1) }
    const [difference] = compareFingerprints(expected, short)
    expect(difference?.what).toBe('page-count')
  })
})

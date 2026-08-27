// DOCX packaging and adapter specifics.
//
// Parity — the same content on the same page — is asserted in
// `export-parity.test.ts` through the shared fingerprint. What is left here is
// what only the DOCX adapter can be asked: that the package is a Word file a
// browser will download, that it is cut to the plan's sheet, that one planned
// page is one Word section, and that links and pictures survive as
// relationships and parts rather than as text about them.

import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { createExamDocx, createExamDocxDocument, docxFilename } from './docx-export'
import { docxFingerprint } from './docx-fingerprint'
import { parseXml } from './xml'
import { FIXTURES, PIXEL_PNG, paragraph, text } from './export-fixtures'
import { planExport, unmeasured, STUDENT_TEST } from './export-plan'
import type { Exam, Version } from './exam'

const exam: Exam = {
  title: 'Chemistry: Unit 3 / Review',
  questions: [
    {
      id: 'q1',
      type: 'open',
      columns: 'auto',
      doc: {
        type: 'doc',
        content: [paragraph(text('Show  your work')), paragraph()],
      },
    },
  ],
}

const version: Version = { id: 'v1', letter: 'A', questionOrder: ['q1'], choiceOrder: {} }

function planOf(source: Exam = exam, ordering: Version = version) {
  return planExport({
    exam: source,
    version: ordering,
    selection: STUDENT_TEST,
    measure: unmeasured,
  })
}

async function packageOf(blob: Blob): Promise<JSZip> {
  return JSZip.loadAsync(await blob.arrayBuffer())
}

async function part(zip: JSZip, name: string): Promise<string> {
  const file = zip.file(name)
  if (!file) throw new Error(`The package has no ${name}`)
  return file.async('string')
}

describe('DOCX packaging', () => {
  test('builds a Word ZIP blob in the browser-compatible MIME type', async () => {
    const blob = await createExamDocx(planOf(), async () => null)
    const signature = new Uint8Array(await blob.slice(0, 2).arrayBuffer())

    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect([...signature]).toEqual([0x50, 0x4b])
  })

  test('turns the exam title into a filesystem-safe filename', () => {
    expect(docxFilename(exam.title)).toBe('Chemistry- Unit 3 - Review.docx')
    expect(docxFilename('  ...  ')).toBe('Untitled exam.docx')
  })

  test('names the document after the exam and the version it exported', async () => {
    const fingerprint = await docxFingerprint(
      await (await createExamDocx(planOf(), async () => null)).arrayBuffer(),
    )
    expect(fingerprint.title).toBe('Chemistry: Unit 3 / Review')
    expect(fingerprint.version).toBe('A')
  })
})

describe('the plan is the adapter’s only document input', () => {
  test('a document can be built from a plan alone, with no exam in reach', () => {
    const plan = planOf()
    // `createExamDocxDocument` takes a `LayoutPlan` and resolved media. There is
    // no overload that accepts an `Exam`, which is what stops the DOCX path
    // rediscovering ordering, numbering or pagination for itself.
    expect(createExamDocxDocument(plan)).toBeDefined()
  })

  test('the planned title and version letter are what the document carries', async () => {
    const renamed = { ...exam, title: 'Physics Retake' }
    const fingerprint = await docxFingerprint(
      await (
        await createExamDocx(
          planOf(renamed, { ...version, letter: 'C' }),
          async () => null,
        )
      ).arrayBuffer(),
    )
    expect(fingerprint.title).toBe('Physics Retake')
    expect(fingerprint.version).toBe('C')
  })
})

describe('the planned sheet', () => {
  test('is US Letter with the plan’s own margins', async () => {
    const plan = planOf()
    const fingerprint = await docxFingerprint(
      await (await createExamDocx(plan, async () => null)).arrayBuffer(),
    )
    for (const page of fingerprint.pages) {
      expect(page.width).toBe(plan.pageSize.width)
      expect(page.height).toBe(plan.pageSize.height)
      expect(page.margin).toBe(plan.pageSize.margin)
    }
  })

  test('gives every planned page one Word section of its own', async () => {
    const fixture = FIXTURES.find((item) => item.name.includes('split across pages'))!
    const plan = planExport({
      exam: fixture.exam,
      version: fixture.version,
      selection: STUDENT_TEST,
      measure: fixture.measure,
    })
    expect(plan.pages.length).toBeGreaterThan(1)
    const fingerprint = await docxFingerprint(
      await (await createExamDocx(plan, async () => null)).arrayBuffer(),
    )
    expect(fingerprint.pages.length).toBe(plan.pages.length)
  })

  test('carries the plan’s own footer numbers rather than a document-wide field', async () => {
    const fixture = FIXTURES.find((item) => item.name.includes('split across pages'))!
    const plan = planExport({
      exam: fixture.exam,
      version: fixture.version,
      selection: STUDENT_TEST,
      measure: fixture.measure,
    })
    const fingerprint = await docxFingerprint(
      await (await createExamDocx(plan, async () => null)).arrayBuffer(),
    )
    expect(fingerprint.pages.map((page) => page.footer)).toEqual(
      plan.pages.map((page) => [`para ${page.furniture.pageNumber}`]),
    )
  })
})

describe('links and pictures', () => {
  test('a link becomes a package relationship carrying its destination', async () => {
    const fixture = FIXTURES.find((item) => item.name.includes('a link and'))!
    const blob = await createExamDocx(
      planExport({
        exam: fixture.exam,
        version: fixture.version,
        selection: STUDENT_TEST,
        measure: unmeasured,
      }),
      async () => null,
    )
    const relationships = await part(
      await packageOf(blob),
      'word/_rels/document.xml.rels',
    )
    expect(relationships).toContain('https://example.test/notes')
  })

  test('an image is packaged as real bytes, not as text about a picture', async () => {
    const fixture = FIXTURES.find((item) => item.name.includes('inline and block images'))!
    const zip = await packageOf(
      await createExamDocx(
        planExport({
          exam: fixture.exam,
          version: fixture.version,
          selection: STUDENT_TEST,
          measure: unmeasured,
        }),
        async () => PIXEL_PNG,
      ),
    )
    const media = Object.entries(zip.files).filter(
      ([name, file]) => name.startsWith('word/media/') && !file.dir,
    )
    expect(media.length).toBeGreaterThan(0)
    const body = await part(zip, 'word/document.xml')
    expect(body).toContain('<w:drawing>')
    expect(body).not.toContain('[Image:')
  })

  test('an image whose bytes cannot be read degrades to its alt text', async () => {
    const fixture = FIXTURES.find((item) => item.name.includes('inline and block images'))!
    const body = await part(
      await packageOf(
        await createExamDocx(
          planExport({
            exam: fixture.exam,
            version: fixture.version,
            selection: STUDENT_TEST,
            measure: unmeasured,
          }),
          async () => null,
        ),
      ),
      'word/document.xml',
    )
    // Loudly wrong beats silently missing: the reader can see what was lost.
    expect(body).toContain('[Image: burner]')
  })
})

describe('lists are numbering, not typed-in markers', () => {
  test('each authored list gets its own numbering instance', async () => {
    const fixture = FIXTURES.find((item) => item.name.includes('bullet, ordered'))!
    const zip = await packageOf(
      await createExamDocx(
        planExport({
          exam: fixture.exam,
          version: fixture.version,
          selection: STUDENT_TEST,
          measure: unmeasured,
        }),
        async () => null,
      ),
    )
    const numbering = parseXml(await part(zip, 'word/numbering.xml'))
    const instances = JSON.stringify(numbering).match(/w:num"/g) ?? []
    expect(instances.length).toBeGreaterThan(0)
    // The ordered list is authored to start at three, and the package says so
    // rather than restating the numbers as literal text.
    expect(await part(zip, 'word/numbering.xml')).toContain('w:start w:val="3"')
  })
})

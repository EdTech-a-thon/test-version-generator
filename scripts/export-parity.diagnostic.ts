// The out-of-band export comparison.
//
// This is the heavyweight diagnostic, not part of `bun test` and not part of
// `bun run test:e2e`. It is invoked by `bun run test:exports`, which checks its
// prerequisites first. See `docs/export-testing.md` for the invocation policy.
//
// What it does, per fixture, at the highest seam the product has:
//
//   1. Seeds the real application with the fixture and lets it settle.
//   2. Captures the dialog's clean print-reference preview as the Reference PDF
//      with the pinned Playwright Chromium.
//   3. Downloads the real DOCX through that same dialog.
//   4. Renders that DOCX to PDF with the pinned LibreOffice Comparison Engine.
//   5. Compares page count, page dimensions and ordered content per page.
//   6. Compares the DOCX's structural fingerprint against the Layout Plan.
//
// Everything it produced is kept when it fails, in `export-artifacts/`.

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  comparePdfs,
  describePdfDifferences,
  equationWords,
  pdfManifest,
  type PdfManifest,
} from './pdf-manifest'
import { checkPrerequisites, environmentReport } from './export-environment'
import { seedAuthoringState } from './seed-authoring'
import { FIXTURES, PIXEL_PNG, type Fixture } from '../src/export-fixtures'
import { imageSourcesOf } from '../src/docx-export'
import { orderedChoices, type Question } from '../src/exam'
import type { ProseMirrorJSON } from '../src/question-doc'
import { buildExportDocument, STUDENT_TEST } from '../src/export-plan'
import {
  plansOf,
  prepareExport,
  versionRange,
  EMPTY_PUBLICATION_HISTORY,
  type ExportConfiguration,
} from '../src/export-preparation'
import {
  compareFingerprints,
  describeDifferences,
  exportDocumentFingerprint,
  layoutFingerprint,
} from '../src/export-fingerprint'
import { printDocumentFingerprint } from '../src/print-fingerprint'
import { docxFingerprint } from '../src/docx-fingerprint'

const ARTIFACTS = join(process.cwd(), 'export-artifacts')

// The fixtures worth the cost of a browser, a converter and two PDFs: the ones
// that combine features, cross a page boundary, or carry content the DOCX path
// has historically lost. The fast suite covers every feature on its own.
const COMPARED = new Set([
  'a realistic composite exam',
  'a four-column choice grid with an empty cell',
  'inline and block images',
  'a table with a header row',
  'a question that moves whole to the next page',
])

function configurationOf(): ExportConfiguration {
  return {
    selection: { test: true, answerKey: true },
  }
}

const fixtures = FIXTURES.filter((fixture) => COMPARED.has(fixture.name))

/** Every equation source the printed document contains, read back out of its
 *  own fingerprint rather than guessed at from the exam. */
function mathSourcesOf(fingerprint: {
  pages: readonly { content: readonly string[] }[]
}): string[] {
  return fingerprint.pages.flatMap((page) =>
    page.content.flatMap((line) =>
      [...line.matchAll(/⟨math:([^⟩]*)⟩/g)].map((match) => match[1] ?? ''),
    ),
  )
}

function slug(name: string): string {
  return name
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function convertToPdf(docx: string, outputDirectory: string): string {
  const profile = join(outputDirectory, 'libreoffice-profile')
  const result = spawnSync(
    'soffice',
    [
      '--headless',
      '--norestore',
      '--nolockcheck',
      `-env:UserInstallation=file://${profile}`,
      '--convert-to',
      'pdf:writer_pdf_Export',
      '--outdir',
      outputDirectory,
      docx,
    ],
    {
      encoding: 'utf8',
      timeout: 180_000,
      env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
    },
  )
  if (result.status !== 0) {
    throw new Error(
      `LibreOffice conversion failed:\n${result.stdout}\n${result.stderr}`,
    )
  }
  return docx.replace(/\.docx$/, '.pdf')
}

function record(directory: string, name: string, contents: string): void {
  writeFileSync(join(directory, name), contents)
}

function manifestText(manifest: PdfManifest): string {
  return manifest.pages
    .map(
      (page) =>
        `# page ${page.number} — ${page.width}x${page.height} pts\n${page.words.join(' ')}`,
    )
    .join('\n\n')
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  const prerequisites = checkPrerequisites()
  if (!prerequisites.ok) throw new Error(prerequisites.report)
  mkdirSync(ARTIFACTS, { recursive: true })
  record(ARTIFACTS, 'environment.txt', environmentReport(prerequisites.tools))
})

for (const fixture of fixtures) {
  test(`print and DOCX describe the same document: ${fixture.name}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000)
    const directory = join(ARTIFACTS, slug(fixture.name))
    rmSync(directory, { recursive: true, force: true })
    mkdirSync(directory, { recursive: true })

    // The plans the application will prepare for itself, prepared here too so
    // recorded artifacts describe the same canonical test/key publication.
    const configuration = configurationOf()
    const plans = plansOf(
      prepareExport({
        exam: fixture.exam,
        version: fixture.version,
        configuration,
        history: EMPTY_PUBLICATION_HISTORY,
        measure: fixture.measure,
        createdAt: '2026-09-04T12:00:00.000Z',
      }),
    )
    const pageSize = plans[0]!.pageSize
    record(directory, 'fixture.json', JSON.stringify(fixture.exam, null, 2))
    record(
      directory,
      'export-document.json',
      JSON.stringify(
        exportDocumentFingerprint(
          buildExportDocument(fixture.exam, fixture.version, STUDENT_TEST),
        ),
        null,
        2,
      ),
    )
    record(
      directory,
      'layout-plan.json',
      JSON.stringify(layoutFingerprint(plans), null, 2),
    )

    await seed(page, fixture)
    // The application registers its image worker and reloads itself once, so
    // wait for a rendered page rather than for the first navigation.
    await page.goto('/')
    await page.locator('.exam-page').first().waitFor()
    // Media Assets own image bytes. Fixture documents are rewritten to the
    // same content-addressed references the application persists before their
    // normalized authoring records are seeded.
    if (imageSourcesOf(plans).length > 0) {
      await seedImages(page, fixture)
      await page.goto('/')
      await page.locator('.exam-page').first().waitFor()
    }
    await settle(page)

    // 1. The Reference PDF, from the clean print-reference preview configured
    //    through the real export dialog.
    const referencePdf = join(directory, 'reference.pdf')
    await configureExport(page, configuration)
    await page.locator('.export-preview .exam-page').first().waitFor()
    await settle(page)
    const printMarkup = await page.evaluate(
      () => document.querySelector('.export-preview')?.outerHTML ?? '',
    )
    await page.addStyleTag({
      content: `
      @media print {
        .dialog-backdrop { display: block !important; position: static !important; padding: 0 !important; }
        .export-dialog { display: block !important; width: auto !important; max-height: none !important; box-shadow: none !important; }
        .dialog-header, .export-controls, .export-actions { display: none !important; }
        .export-publication-body, .export-preview { display: block !important; padding: 0 !important; overflow: visible !important; background: #fff !important; }
        .export-preview .exam-workspace { display: block !important; }
      }
    `,
    })
    await page.pdf({
      path: referencePdf,
      width: '8.5in',
      height: '11in',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: false,
      preferCSSPageSize: false,
    })
    await page.reload()
    await page.locator('.exam-page').first().waitFor()
    await settle(page)

    // 2. The real DOCX, downloaded the way a teacher downloads it — the same
    //    configuration and canonical plans.
    const downloadPromise = page.waitForEvent('download')
    await configureExport(page, configuration)
    await page.getByRole('button', { name: 'Download DOCX' }).click()
    const download = await downloadPromise
    const docx = join(directory, 'export.docx')
    await download.saveAs(docx)

    // The media-rich composite is downloaded again from stored history. A
    // matching fingerprint must use the immutable canonical plans byte-for-
    // semantic-byte rather than rebuilding a second historical path.
    if (fixture.name === 'a realistic composite exam') {
      const historicalPromise = page.waitForEvent('download')
      await configureExport(page, configuration)
      await page.getByRole('button', { name: 'Download DOCX' }).click()
      const historical = join(directory, 'historical-export.docx')
      await (await historicalPromise).saveAs(historical)
      expect(await docxFingerprint(readFileSync(historical))).toEqual(
        await docxFingerprint(readFileSync(docx)),
      )
    }

    // 3. Structural parity, against the document the browser actually laid out
    //    — real measurement, real page assignment, not a plan this file built
    //    for itself. The plan is written out beside it as a diagnostic only.
    const printed = printDocumentFingerprint(printMarkup, {
      title: fixture.exam.title,
      version: versionRange(plans.map((one) => one.version.letter)),
      width: pageSize.width,
      height: pageSize.height,
      margin: pageSize.margin,
    })
    record(directory, 'print-document.json', JSON.stringify(printed, null, 2))
    const structural = compareFingerprints(
      printed,
      await docxFingerprint(readFileSync(docx)),
    )
    record(directory, 'structural-report.txt', describeDifferences(structural))

    // 4. Page parity, through the Comparison Engine.
    const convertedPdf = convertToPdf(docx, directory)
    const reference = pdfManifest(referencePdf)
    const converted = pdfManifest(convertedPdf)
    record(directory, 'reference-manifest.txt', manifestText(reference))
    record(directory, 'docx-manifest.txt', manifestText(converted))
    const paged = comparePdfs(
      reference,
      converted,
      equationWords(mathSourcesOf(printed)),
    )
    record(directory, 'page-report.txt', describePdfDifferences(paged))

    const failed = structural.length > 0 || paged.length > 0
    if (failed) {
      await testInfo.attach('structural-report', {
        path: join(directory, 'structural-report.txt'),
      })
      await testInfo.attach('page-report', {
        path: join(directory, 'page-report.txt'),
      })
    } else {
      // Nothing failed, so nothing needs explaining. Only failures keep bytes.
      rmSync(join(directory, 'libreoffice-profile'), {
        recursive: true,
        force: true,
      })
    }

    expect(describeDifferences(structural)).toBe('no differences')
    expect(describePdfDifferences(paged)).toBe('no differences')
  })
}

/** Rewrites fixture image references to one content-addressed Media Asset. */
async function seedImages(
  page: import('@playwright/test').Page,
  fixture: Fixture,
): Promise<void> {
  const owned = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0),
    )
    const file = new File([bytes], 'fixture.png', { type: 'image/png' })
    const { saveImage } = await import('/src/local-images.ts')
    return saveImage(file)
  }, Buffer.from(PIXEL_PNG.data).toString('base64'))
  const replace = (node: ProseMirrorJSON): ProseMirrorJSON => ({
    ...node,
    attrs:
      node.type === 'image' || node.type === 'image-block'
        ? { ...(node.attrs as object), src: owned }
        : node.attrs,
    content: Array.isArray(node.content)
      ? node.content.map((child) => replace(child as ProseMirrorJSON))
      : node.content,
  })
  const exam = {
    ...fixture.exam,
    questions: fixture.exam.questions.map((question) => ({
      ...question,
      doc: replace(question.doc),
    })),
  }
  await seedAuthoringState(page, {
    questionBank: { questions: authoredInVersionOrder({ ...fixture, exam }) },
    examDraft: {
      title: exam.title,
      questionIds: fixture.version.questionOrder,
    },
    dirty: false,
  })
}

/** Drives the real one-Version export dialog to one Content Selection. */
async function configureExport(
  page: import('@playwright/test').Page,
  configuration: ExportConfiguration,
): Promise<void> {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export DOCX' })
  await dialog.waitFor()
  await dialog
    .getByRole('checkbox', { name: 'Student test' })
    .setChecked(configuration.selection.test)
  await dialog
    .getByRole('checkbox', { name: 'Answer key' })
    .setChecked(configuration.selection.answerKey)
}

/** The fixture's questions with their answers already in the fixture Version's
 *  order. An Exam Draft records no choice order — answers print in the order
 *  they were authored in — so a fixture that permuted its answers is seeded
 *  with them authored that way, which is the same paper by another route. */
function authoredInVersionOrder(fixture: Fixture): Question[] {
  return fixture.exam.questions.map((question) => {
    const ordered = orderedChoices(question, fixture.version)
    if (ordered.length === 0) return question
    const content = (question.doc.content as ProseMirrorJSON[]).map((node) =>
      node.type === 'multipleChoice'
        ? { ...node, content: ordered.map((choice) => choice.node) }
        : node,
    )
    return { ...question, doc: { ...question.doc, content } }
  })
}

/** The fixture, put where the application looks for its authoring state. */
async function seed(
  page: import('@playwright/test').Page,
  fixture: Fixture,
): Promise<void> {
  await seedAuthoringState(page, {
    questionBank: { questions: authoredInVersionOrder(fixture) },
    examDraft: {
      title: fixture.exam.title,
      questionIds: fixture.version.questionOrder,
    },
    dirty: false,
  })
}

/** Fonts and images decide the page's real height, and the application
 *  repaginates once they have settled. Wait for that, not for a fixed delay. */
async function settle(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts?.ready
    await Promise.all(
      Array.from(document.images)
        .filter((image) => !image.complete)
        .map(
          (image) =>
            new Promise((resolve) => {
              image.addEventListener('load', resolve, { once: true })
              image.addEventListener('error', resolve, { once: true })
            }),
        ),
    )
  })
  // One more frame after the last re-measurement the application schedules.
  await page.waitForTimeout(500)
}

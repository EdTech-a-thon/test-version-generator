// The out-of-band export comparison.
//
// This is the heavyweight diagnostic, not part of `bun test` and not part of
// `bun run test:e2e`. It is invoked by `bun run test:exports`, which checks its
// prerequisites first. See `docs/export-testing.md` for the invocation policy.
//
// What it does, per fixture, at the highest seam the product has:
//
//   1. Seeds the real application with the fixture and lets it settle.
//   2. Captures the print Export Adapter as the Reference PDF with the pinned
//      Playwright Chromium, through the real export dialog.
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
import { FIXTURES, PIXEL_PNG, seededRandom, type Fixture } from '../src/export-fixtures'
import { imageSourcesOf } from '../src/docx-export'
import { buildExportDocument, STUDENT_TEST } from '../src/export-plan'
import {
  plansOf,
  prepareExport,
  versionRange,
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
  // Several Generated Versions and both Content Selection streams, in one
  // print operation and one Word package.
  'a realistic composite exam in three versions with answer keys',
  'a four-column choice grid with an empty cell',
  'inline and block images',
  'a table with a header row',
  'a question that moves whole to the next page',
])

/** The seed both runs draw from. Randomization is a fresh draw in production;
 *  the comparison needs the print run and the Word run to publish the same
 *  Generated Versions, so the diagnostic pins the source before each export. */
const SEED = 20260828

function configurationOf(fixture: Fixture, format: 'print' | 'docx'): ExportConfiguration {
  return {
    format,
    selection: { test: true, answerKey: fixture.answerKey ?? false },
    versionCount: fixture.versions ?? 1,
    randomization: fixture.randomization ?? { questions: false, answers: false },
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
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
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
    throw new Error(`LibreOffice conversion failed:\n${result.stdout}\n${result.stderr}`)
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

    // The plans the application will prepare for itself, prepared here too —
    // from the same seed — so the recorded artifacts describe the same export
    // and the image seeding knows which pictures to put in the cache.
    const configuration = configurationOf(fixture, 'print')
    const plans = plansOf(
      prepareExport({
        exam: fixture.exam,
        version: fixture.version,
        configuration,
        random: seededRandom(SEED),
        measure: fixture.measure,
      }),
    )
    const pageSize = plans[0]!.pageSize
    record(directory, 'fixture.json', JSON.stringify(fixture.exam, null, 2))
    record(
      directory,
      'export-document.json',
      JSON.stringify(
        exportDocumentFingerprint(
          buildExportDocument(
            fixture.exam,
            fixture.version,
            STUDENT_TEST,
            fixture.measure,
          ),
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
    await stubPrintDialog(page)
    await pinRandomness(page)
    // The application registers its image worker and reloads itself once, so
    // wait for a rendered page rather than for the first navigation.
    await page.goto('/')
    await page.locator('.exam-page').first().waitFor()
    // A teacher's uploads live in Cache Storage, served back by that worker. A
    // fixture's images have to be put there the same way, or both outputs would
    // agree on a picture neither of them has.
    const sources = imageSourcesOf(plans)
    if (sources.length > 0) {
      await seedImages(page, sources)
      await page.goto('/')
      await page.locator('.exam-page').first().waitFor()
    }
    await settle(page)

    // 1. The Reference PDF, out of the print Export Adapter the application
    //    actually prints, configured through the real export dialog.
    const referencePdf = join(directory, 'reference.pdf')
    await configureExport(page, configuration)
    await page.getByRole('button', { name: 'Print', exact: true }).click()
    // Attached, not visible: the print document is `display: none` until print
    // media applies, which is exactly what `page.pdf()` applies.
    await page
      .locator('.print-output .exam-page')
      .first()
      .waitFor({ state: 'attached' })
    await settle(page)
    // Read straight off the document, and before the capture: `printToPDF`
    // fires `afterprint`, which is the application's cue to take the print
    // document down again. A locator would be no good either — the print output
    // is `display: none` until print media applies.
    const printMarkup = await page.evaluate(
      () => document.querySelector('.print-output')?.outerHTML ?? '',
    )
    await page.pdf({
      path: referencePdf,
      width: '8.5in',
      height: '11in',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: false,
      preferCSSPageSize: false,
    })
    // The printed markup, while it is still mounted: this is the reference for
    // structural parity, and it is the same DOM the PDF was just made from.
    await page.reload()
    await page.locator('.exam-page').first().waitFor()
    await settle(page)

    // 2. The real DOCX, downloaded the way a teacher downloads it — the same
    //    configuration, the same seed, so the same Generated Versions.
    const downloadPromise = page.waitForEvent('download')
    await configureExport(page, configurationOf(fixture, 'docx'))
    await page.getByRole('button', { name: 'Download DOCX' }).click()
    const download = await downloadPromise
    const docx = join(directory, 'export.docx')
    await download.saveAs(docx)

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
    const paged = comparePdfs(reference, converted, equationWords(mathSourcesOf(printed)))
    record(directory, 'page-report.txt', describePdfDifferences(paged))

    const failed = structural.length > 0 || paged.length > 0
    if (failed) {
      await testInfo.attach('structural-report', {
        path: join(directory, 'structural-report.txt'),
      })
      await testInfo.attach('page-report', { path: join(directory, 'page-report.txt') })
    } else {
      // Nothing failed, so nothing needs explaining. Only failures keep bytes.
      rmSync(join(directory, 'libreoffice-profile'), { recursive: true, force: true })
    }

    expect(describeDifferences(structural)).toBe('no differences')
    expect(describePdfDifferences(paged)).toBe('no differences')
  })
}

/** The fixture's pictures, put in the cache the image worker reads. */
async function seedImages(
  page: import('@playwright/test').Page,
  sources: readonly string[],
): Promise<void> {
  await page.evaluate(
    async ({ urls, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (character) =>
        character.charCodeAt(0),
      )
      const cache = await caches.open('crepe-local-images-v1')
      for (const url of urls) {
        await cache.put(
          url,
          new Response(bytes, { headers: { 'Content-Type': 'image/png' } }),
        )
      }
    },
    {
      urls: [...sources],
      base64: Buffer.from(PIXEL_PNG.data).toString('base64'),
    },
  )
}

/** Drives the real export dialog to one configuration, having pinned the
 *  random source first: two exports of the same fixture must publish the same
 *  Generated Versions, or there would be nothing to compare. */
async function configureExport(
  page: import('@playwright/test').Page,
  configuration: ExportConfiguration,
): Promise<void> {
  await page.evaluate(
    (seed) => (window as unknown as { seedRandom(seed: number): void }).seedRandom(seed),
    SEED,
  )
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export' })
  await dialog.waitFor()
  await dialog
    .getByRole('radio', {
      name: configuration.format === 'print' ? 'Print / Save as PDF' : 'Word (.docx)',
    })
    .check()
  await dialog
    .getByRole('checkbox', { name: 'Student test' })
    .setChecked(configuration.selection.test)
  await dialog
    .getByRole('checkbox', { name: 'Answer key' })
    .setChecked(configuration.selection.answerKey)
  await dialog
    .getByRole('spinbutton', { name: 'Versions' })
    .fill(String(configuration.versionCount))
  await dialog
    .getByRole('checkbox', { name: 'Shuffle question order' })
    .setChecked(configuration.randomization.questions)
  await dialog
    .getByRole('checkbox', { name: 'Shuffle answer order' })
    .setChecked(configuration.randomization.answers)
}

/** The same generator `seededRandom` uses, installed over `Math.random` and
 *  re-seeded before each export. Production draws freshly; the comparison
 *  cannot. */
async function pinRandomness(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    ;(window as unknown as { seedRandom(seed: number): void }).seedRandom = (
      seed: number,
    ) => {
      let state = seed >>> 0 || 1
      Math.random = () => {
        state = (state * 1664525 + 1013904223) >>> 0
        return state / 0x100000000
      }
    }
  })
}

/**
 * Stands in for the browser's print dialog.
 *
 * The application keeps its print document mounted until `afterprint` fires. A
 * headless capture never opens a dialog, so `window.print()` becomes a no-op
 * and no `afterprint` follows: the document stays put for as long as producing
 * the PDF takes, which is what a real, open dialog would also do.
 */
async function stubPrintDialog(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.addInitScript(() => {
    window.print = () => {}
  })
}

/** The fixture, put where the application looks for its draft. */
async function seed(
  page: import('@playwright/test').Page,
  fixture: Fixture,
): Promise<void> {
  await page.addInitScript(
    (draft) => {
      localStorage.setItem('exam-draft-v1', JSON.stringify(draft))
    },
    {
      exam: fixture.exam,
      versions: [fixture.version],
      currentVersionId: fixture.version.id,
      dirty: false,
    },
  )
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

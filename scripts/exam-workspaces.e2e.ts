import { expect, test } from '@playwright/test'

test('the IndexedDB workspace service keeps UUID identities and recency apart from authoring writes', async ({ page }) => {
  await page.goto('/')
  // The image worker may take control and reload once on the first visit.
  await page.getByRole('heading', { name: 'Recent Exams', exact: true }).waitFor()
  const result = await page.evaluate(async () => {
    const { createExamWorkspaceService } = await import(
      /* @vite-ignore */ '/src/exam-workspaces.ts'
    ) as typeof import('../src/exam-workspaces')
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]
    let index = 0
    let tick = 0
    const workspaces = createExamWorkspaceService({
      createId: () => ids[index++]!,
      now: () => new Date(`2026-01-01T00:00:0${tick++}.000Z`),
    })
    const first = await workspaces.create()
    const second = await workspaces.create()
    await workspaces.backendFor(first.id).write({
      questionBank: { questions: [] },
      examDraft: { title: 'First stored Exam', questionIds: [] },
      dirty: true,
    })
    await workspaces.backendFor(second.id).write({
      questionBank: { questions: [] },
      examDraft: { title: 'Second stored Exam', questionIds: [] },
      dirty: true,
    })
    await workspaces.open(first.id)
    const opened = await workspaces.recent()
    // This is a background authoring write. It must not call `open` or change
    // the registry's last-opened order.
    await workspaces.backendFor(second.id).write({
      questionBank: { questions: [] },
      examDraft: { title: 'Second changed in background', questionIds: [] },
      dirty: true,
    })
    return {
      first,
      second,
      active: await workspaces.activeId(),
      opened: opened.map((exam) => exam.id),
      afterBackgroundWrite: (await workspaces.recent()).map((exam) => ({ id: exam.id, title: exam.title })),
    }
  })

  expect(result.first.id).toBe('11111111-1111-4111-8111-111111111111')
  expect(result.second.id).toBe('22222222-2222-4222-8222-222222222222')
  expect(result.active).toBe(result.first.id)
  expect(result.opened).toEqual([result.first.id, result.second.id])
  expect(result.afterBackgroundWrite).toEqual([
    { id: result.first.id, title: 'First stored Exam' },
    { id: result.second.id, title: 'Second changed in background' },
  ])
})

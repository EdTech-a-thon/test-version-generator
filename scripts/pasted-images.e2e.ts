import { expect, test, type Locator } from '@playwright/test'

async function pastePng(target: Locator) {
  await target.evaluate(async (element) => {
    const png = await fetch('/logo.png').then((response) => response.blob())
    const clipboard = new DataTransfer()
    clipboard.items.add(new File([png], 'pasted.png', { type: 'image/png' }))
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }),
    )
  })
}

async function pasteHtmlImage(target: Locator, html: string) {
  await target.evaluate((element, pastedHtml) => {
    const clipboard = new DataTransfer()
    clipboard.setData('text/html', pastedHtml)
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }),
    )
  }, html)
}

async function pasteHtmlImageWithFile(target: Locator, html: string) {
  await target.evaluate(async (element, pastedHtml) => {
    const png = await fetch('/logo.png').then((response) => response.blob())
    const clipboard = new DataTransfer()
    clipboard.setData('text/html', pastedHtml)
    clipboard.items.add(new File([png], 'copied-image.png', { type: 'image/png' }))
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }),
    )
  }, html)
}

async function writePngToClipboard(page: import('@playwright/test').Page) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(async () => {
    const png = await fetch('/logo.png').then((response) => response.blob())
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
  })
}

test('pasted image files render and persist with a question', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Insert your first question' }).click()
  await page.getByRole('menuitem', { name: 'Multiple choice' }).click()

  const dialog = page.getByRole('dialog', { name: 'Question editor' })
  const editor = dialog.locator('.ProseMirror')
  await editor.locator('> p').first().fill('Question with a pasted image')
  await editor.locator('> p').first().press('End')
  await pastePng(editor)

  const pastedImage = editor.locator('img[src^="/local-images/"]')
  await expect(pastedImage).toHaveCount(1)
  await expect
    .poll(() =>
      pastedImage.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Save question' }).click()
  const question = page.locator('.exam-question').first()
  await expect(question.locator('img[src^="/local-images/"]')).toHaveCount(1)

  await question.dblclick()
  await expect(dialog.locator('img[src^="/local-images/"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.reload()
  const reloadedImage = page
    .locator('.exam-question')
    .first()
    .locator('img[src^="/local-images/"]')
  await expect(reloadedImage).toHaveCount(1)
  await expect
    .poll(() =>
      reloadedImage.evaluate(
        (image) => (image as HTMLImageElement).naturalWidth,
      ),
    )
    .toBeGreaterThan(0)
})

test('images paste through the native browser clipboard', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Insert your first question' }).click()
  await page.getByRole('menuitem', { name: 'Multiple choice' }).click()

  const dialog = page.getByRole('dialog', { name: 'Question editor' })
  const editor = dialog.locator('.ProseMirror')
  await editor.locator('> p').first().click()
  await writePngToClipboard(page)
  await page.keyboard.press('Control+V')

  await expect(editor.locator('img[src^="/local-images/"]')).toHaveCount(1)
})

test('copied web images render and persist with a question', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Insert your first question' }).click()
  await page.getByRole('menuitem', { name: 'Multiple choice' }).click()

  const dialog = page.getByRole('dialog', { name: 'Question editor' })
  const editor = dialog.locator('.ProseMirror')
  await editor.locator('> p').first().click()
  await pasteHtmlImage(editor, '<img src="/logo.png" alt="Crepe">')

  const imageBlock = editor.locator('.milkdown-image-block')
  await expect(imageBlock.locator('img[src="/logo.png"]')).toHaveCount(1)
  await expect(imageBlock.locator('.image-resize-handle')).toHaveCount(1)
  await page.getByRole('button', { name: 'Save question' }).click()
  const question = page.locator('.exam-question').first()
  await expect(question.locator('img[src="/logo.png"]')).toHaveCount(1)
})

test('copied web images with a clipboard file use a resizable block', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Insert your first question' }).click()
  await page.getByRole('menuitem', { name: 'Multiple choice' }).click()

  const dialog = page.getByRole('dialog', { name: 'Question editor' })
  const editor = dialog.locator('.ProseMirror')
  await editor.locator('> p').first().click()
  await pasteHtmlImageWithFile(editor, '<img src="/logo.png" alt="Crepe">')

  const imageBlock = editor.locator('.milkdown-image-block')
  await expect(imageBlock.locator('img')).toHaveCount(1)
  await expect(imageBlock.locator('.image-resize-handle')).toHaveCount(1)
})

test('image files paste into answer choices', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Insert your first question' }).click()
  await page.getByRole('menuitem', { name: 'Multiple choice' }).click()

  const dialog = page.getByRole('dialog', { name: 'Question editor' })
  const firstChoice = dialog.locator('.mc-choice-body').first()
  await firstChoice.locator('p').click()
  await pastePng(firstChoice)

  await expect(firstChoice.locator('img[src^="/local-images/"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Save question' }).click()
  const question = page.locator('.exam-question').first()
  await expect(
    question.locator('.choice-body img[src^="/local-images/"]'),
  ).toHaveCount(1)
})

import { expect, test } from '@playwright/test'
import { expectNoRendererErrors, getMarkdownContent, launchWithMarkdown, sendIpcToRenderer } from './helpers'

test('resizes a selected tall image from a visible edge after scrolling past the middle', async() => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="540" height="1760"><rect width="540" height="1760" fill="steelblue"/></svg>').toString('base64')
  const imageTag = `<img src="data:image/svg+xml;base64,${svg}" alt="Tall test image" width="540" data-align="left" />`
  const markdown = `# Image resize\n\n${imageTag}\n\n` + 'Text below the image.\n\n'.repeat(24)
  const { app, page } = await launchWithMarkdown(markdown, {
    suppressErrorDialog: true,
    preferences: { floatingTocEnabled: false }
  })

  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 750))
    const editor = page.locator('.editor-component.mu-editor')
    const image = editor.locator('.mu-inline-image.mu-image-success img').first()
    const edge = editor.locator('.mu-transformer .bar.right')
    await expect(image).toBeVisible()
    const start = await image.boundingBox()
    const view = await editor.boundingBox()
    if (!start || !view) throw new Error('Image and editor must have a visible box')
    expect(start.height).toBeGreaterThan(view.height * 2)

    await page.mouse.click(start.x + start.width / 2, Math.max(start.y, view.y) + 75)
    await expect(edge).toBeVisible()
    await page.mouse.wheel(0, Math.ceil(start.y + start.height / 2 - view.y + 130))
    await expect.poll(async() => {
      const box = await image.boundingBox()
      return box ? box.y + box.height / 2 : Infinity
    }).toBeLessThan(view.y - 100)

    const current = await image.boundingBox()
    if (!current) throw new Error('The image is missing after scrolling')
    const handle = { x: current.x + current.width, y: view.y + 90 }
    expect(await edge.evaluate((el, { x, y }) => el.contains(document.elementFromPoint(x, y)), handle)).toBe(true)
    expect(await edge.evaluate((el, { x, y }) => el.contains(document.elementFromPoint(x, y - 92)), handle)).toBe(false)

    await page.mouse.move(handle.x, handle.y)
    await page.mouse.down()
    await page.mouse.move(handle.x - 55, handle.y, { steps: 5 })
    await page.mouse.up()
    await expect(image).toHaveAttribute('width', '485')
    const resized = await image.boundingBox()
    expect(resized?.x).toBeCloseTo(start.x)
    expect(resized?.height).toBeLessThan(start.height)
    await expect(edge).toBeAttached()

    await editor.getByRole('heading', { name: 'Image resize' }).click()
    await expect(edge).toHaveCount(0)
    expect(await getMarkdownContent(page, app)).toContain('width="485"')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect(image).toHaveAttribute('width', '540')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

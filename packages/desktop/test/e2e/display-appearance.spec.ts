import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Locator } from 'playwright'
import {
  expectNoRendererErrors,
  launchElectron,
  launchWithMarkdown,
  waitForEditor
} from './helpers'

const whiteImage = (width: number, height: number) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

const openThemePreferences = async(app: ElectronApplication) => {
  const settingsWindow = app.waitForEvent('window')
  await app.evaluate(({ ipcMain }) => {
    ipcMain.emit('app-create-settings-window')
  })
  const settings = await settingsWindow
  await settings.waitForSelector('.pref-container')
  await settings.evaluate(() => { location.hash = '#/preference/theme' })
  return settings
}

const expectImageColor = async(image: Locator, expected: number[]) => {
  const png = await image.screenshot()
  const pixel = await image.page().evaluate(async(bytes) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(1, 1)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Cannot read the rendered image pixel')
    context.drawImage(bitmap, Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1, 0, 0, 1, 1)
    bitmap.close()
    return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3))
  }, Array.from(png))
  for (const [channel, value] of expected.entries()) {
    expect(Math.abs(pixel[channel] - value)).toBeLessThanOrEqual(2)
  }
}

test('adjusts window and Markdown/HTML images independently and restores saved settings', async() => {
  test.setTimeout(60000)
  const imageSrc = whiteImage(80, 54)
  const markdown = `# Samples\n\n![Markdown sample](${imageSrc})\n\n<div>\n<img alt="HTML sample" src="${imageSrc}">\n</div>\n`
  const { app, page, filePath } = await launchWithMarkdown(markdown, {
    suppressErrorDialog: true,
    preferences: { language: 'zh-CN', theme: 'light', followSystemTheme: false }
  })
  const prefsPath = await app.evaluate(({ app }) => app.getPath('userData'))
  const markdownImage = page.locator('.editor-component .mu-inline-image img').first()
  const htmlImage = page.locator('.editor-component .mu-html-preview img')
  const editorColor = () => page.locator('.editor-with-tabs').evaluate(node => {
    const context = new OffscreenCanvas(1, 1).getContext('2d')
    if (!context) throw new Error('Cannot read the editor background color')
    context.fillStyle = getComputedStyle(node).backgroundColor
    context.fillRect(0, 0, 1, 1)
    return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3))
  })
  let savedPreferences: Record<string, unknown> | undefined

  try {
    await expect(markdownImage).toBeVisible()
    await expect(htmlImage).toBeVisible()
    await expect(markdownImage).toHaveCSS('filter', 'none')
    expect(await editorColor()).toEqual([255, 255, 255])
    const settings = await openThemePreferences(app)
    const global = settings.getByRole('group', { name: '全局' })
    const images = settings.getByRole('group', { name: '图片' })
    const globalWarmth = global.getByRole('slider', { name: /^暖色强度/ })
    const imageWarmth = images.getByRole('slider', { name: /^暖色强度/ })
    await expect(globalWarmth).toHaveValue('40')
    await expect(globalWarmth).toBeDisabled()
    await expect(imageWarmth).toBeDisabled()

    await global.locator('.el-switch').click()
    await expect.poll(editorColor).toEqual([255, 241, 207])
    await expect(globalWarmth).toBeEnabled()
    await globalWarmth.press('End')
    await expect.poll(editorColor).toEqual([255, 219, 135])
    await expectImageColor(markdownImage, [255, 255, 255])
    await expectImageColor(htmlImage, [255, 255, 255])

    await images.getByRole('slider', { name: /^亮度/ }).press('Home')
    await expect(markdownImage).toHaveCSS('filter', 'brightness(0.4)')
    await expectImageColor(htmlImage, [102, 102, 102])
    const imageSwitch = images.locator('.el-switch')
    await imageSwitch.click()
    await imageWarmth.press('End')
    await expect(imageWarmth).toHaveValue('100')
    await global.getByRole('slider', { name: /^亮度/ }).press('Home')
    const dim = page.locator('.editor-window-dim')
    await expect(dim).toHaveCSS('opacity', '0.5')
    await expectImageColor(markdownImage, [51, 44, 27])
    await expectImageColor(htmlImage, [51, 44, 27])

    await imageSwitch.click()
    await expect(imageWarmth).toBeDisabled()
    await expect(htmlImage).toHaveCSS('filter', 'brightness(0.4)')
    await expectImageColor(htmlImage, [51, 51, 51])
    await imageSwitch.click()
    await expect(imageWarmth).toHaveValue('100')
    await expect(htmlImage).toHaveCSS('filter', /url.*mdeditor-image-warmth/)
    await expectImageColor(htmlImage, [51, 44, 27])

    const search = settings.getByRole('textbox', { name: '搜索偏好设置…' })
    await search.click()
    await search.fill('图片亮度')
    await expect(settings.getByText('图片亮度', { exact: true })).toBeVisible()
    await search.press('Escape')

    await page.emulateMedia({ media: 'print' })
    await expect(dim).toBeHidden()
    await expect(htmlImage).toHaveCSS('filter', 'none')
    await page.emulateMedia({ media: 'screen' })
    expect(fs.readFileSync(filePath, 'utf8')).toBe(markdown)
    await expectNoRendererErrors(app)
    savedPreferences = JSON.parse(fs.readFileSync(path.join(prefsPath, 'preferences.json'), 'utf8'))
    expect(savedPreferences).toMatchObject({
      windowBrightness: 50,
      windowEyeComfort: true,
      windowWarmth: 100,
      imageBrightness: 40,
      imageEyeComfort: true,
      imageWarmth: 100
    })
  } finally {
    await app.close()
  }

  const restarted = await launchElectron([filePath], {
    preferences: savedPreferences,
    suppressErrorDialog: true
  })
  try {
    await waitForEditor(restarted.page)
    await expect(restarted.page.locator('.editor-window-dim')).toHaveCSS('opacity', '0.5')
    await expectImageColor(restarted.page.locator('.mu-html-preview img'), [51, 44, 27])
    await expectNoRendererErrors(restarted.app)
  } finally {
    await restarted.app.close()
  }
})

test('keeps the current heading synchronized when scrolling past filtered tall images', async() => {
  const imageSrc = whiteImage(540, 1500)
  const markdown = `# First\n\n![Tall Markdown image](${imageSrc})\n\n# Second\n\n<div>\n<img src="${imageSrc}">\n</div>\n\n# Third\n\n` +
    'Text below the images.\n\n'.repeat(40)
  const { app, page } = await launchWithMarkdown(markdown, {
    suppressErrorDialog: true,
    preferences: {
      windowBrightness: 80,
      windowEyeComfort: true,
      imageBrightness: 75,
      imageEyeComfort: true,
      floatingTocEnabled: true
    }
  })
  try {
    const editor = page.locator('.editor-component.mu-editor')
    await expect(editor.locator('img').nth(1)).toBeVisible()
    const activeHeading = page.locator('.floating-toc li.active .toc-heading')
    await expect(activeHeading).toHaveAttribute('data-heading-index', '0')
    const bounds = await editor.boundingBox()
    if (!bounds) throw new Error('The editor is not visible')
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 90)
    await page.mouse.wheel(0, 1700)
    await expect(activeHeading).toHaveAttribute('data-heading-index', '1')
    await page.mouse.wheel(0, 1700)
    await expect(activeHeading).toHaveAttribute('data-heading-index', '2')
    await page.mouse.wheel(0, -3400)
    await expect(activeHeading).toHaveAttribute('data-heading-index', '0')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

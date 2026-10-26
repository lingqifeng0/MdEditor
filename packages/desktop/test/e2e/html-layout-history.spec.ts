import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, expectNoRendererErrors, sendIpcToRenderer } from './helpers'

const image = (width: number, height: number, color: string) => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`).toString('base64')
const fixture = `# 图文布局\n\n<p id="row" style="display:flex;align-items:flex-end;gap:16px;width:640px;max-width:100%">\n<span id="column-a" style="display:inline-flex;flex-direction:column;align-items:center;width:90px"><img id="image-a" src="${image(90, 130, '#308ec5')}" width="90"><span>普通电感</span></span>\n<span id="column-b" style="display:inline-flex;flex-direction:column;align-items:center;width:170px"><img id="image-b" src="${image(170, 110, '#5e78a4')}" width="170"><span>非屏蔽电感</span></span>\n<span id="column-c" style="display:inline-flex;position:relative;flex-direction:column;justify-content:center;align-items:center;width:160px"><img id="image-c" src="${image(160, 90, '#709a68')}" width="160"><span id="caption-c">屏蔽电感</span></span>\n</p>\n\n尾部说明\n`
const preferences = { language: 'zh-CN', theme: 'dark', followSystemTheme: false, fontSize: 17 }

test.describe('HTML modal history and structural layout', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeEach(async() => {
    const launched = await launchWithMarkdown(fixture, { suppressErrorDialog: true, preferences })
    app = launched.app
    page = launched.page
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setSize(1440, 1000)
      window.webContents.setBackgroundThrottling(false)
      window.hide()
    })
  })

  test.afterEach(async() => {
    if (!app) return
    await expectNoRendererErrors(app)
    await app.evaluate(({ BrowserWindow, app }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  })

  const open = async() => {
    await page.locator('.mu-html-preview').hover()
    await page.getByRole('button', { name: '编辑 HTML 布局', exact: true }).click()
    await expect(page.getByTestId('html-layout-editor')).toBeVisible()
    await expect.poll(() => page.getByTestId('html-layout-stage').locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete))).toBe(true)
  }
  const boxes = () => page.getByTestId('html-layout-stage').evaluate(stage => {
    const row = stage.querySelector('#row')
    if (!row) throw new Error('Missing image row')
    const root = row.getBoundingClientRect()
    return [
      [root.width, root.height],
      ...Array.from(stage.querySelectorAll('img'), image => {
        const box = image.getBoundingClientRect()
        return [box.left - root.left, box.top - root.top, box.width, box.height]
      })
    ]
  })
  const sameBoxes = async(before: number[][]) => {
    await expect.poll(async() => {
      const current = await boxes()
      return Math.max(...current.flatMap((box, index) => box.map((value, dimension) => Math.abs(value - before[index][dimension]))))
    }).toBeLessThan(0.6)
  }

  test('caption deletion and undo/redo preserve images and frame through Apply and reopen', async() => {
    await open()
    const before = await boxes()
    await page.getByTestId('html-layout-stage').locator('#caption-c').click()
    await page.getByTestId('html-layout-delete-text').click()
    await expect(page.getByTestId('html-layout-stage').locator('#caption-c')).toHaveCount(0)
    await sameBoxes(before)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect(page.getByTestId('html-layout-stage').locator('#caption-c')).toHaveText('屏蔽电感')
    await sameBoxes(before)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await expect(page.getByTestId('html-layout-stage').locator('#caption-c')).toHaveCount(0)
    await sameBoxes(before)
    await page.getByTestId('html-layout-apply').click()
    await expect(page.getByTestId('html-layout-editor')).toHaveCount(0)
    await open()
    await expect(page.getByTestId('html-layout-stage').locator('#caption-c')).toHaveCount(0)
    await sameBoxes(before)
  })

  test('Ctrl+Z and redo cover text, font, color, insertion and a drag gesture', async() => {
    await open()
    await page.getByTestId('html-layout-add-text').click()
    const text = page.getByTestId('html-layout-stage').locator('#row > span:not([id])')
    const color = await page.getByTestId('html-layout-text-color').inputValue()
    await page.getByTestId('html-layout-text').fill('新的标注')
    await page.getByTestId('html-layout-font-size').fill('30')
    await page.getByTestId('html-layout-font-size').press('Tab')
    await page.getByTestId('html-layout-text-color').fill('#ff5577')
    await expect(text).toHaveText('新的标注')
    await expect(text).toHaveCSS('font-size', '30px')
    await expect(text).toHaveCSS('color', 'rgb(255, 85, 119)')
    await page.getByTestId('html-layout-text-color').press('Control+z')
    await expect(page.getByTestId('html-layout-text-color')).toHaveValue(color)
    await expect(text).toHaveCSS('font-size', '30px')
    await page.getByTestId('html-layout-undo').click()
    await expect(text).toHaveCSS('font-size', '16px')
    await page.getByTestId('html-layout-undo').click()
    await expect(text).toHaveText('新文字')
    await page.getByTestId('html-layout-undo').click()
    await expect(text).toHaveCount(0)
    await page.getByTestId('html-layout-redo').click()
    await expect(text).toHaveText('新文字')
    await page.getByTestId('html-layout-redo').click()
    await expect(text).toHaveText('新的标注')
    await page.getByTestId('html-layout-redo').click()
    await expect(text).toHaveCSS('font-size', '30px')
    await page.getByTestId('html-layout-redo').click()
    await expect(text).toHaveCSS('color', 'rgb(255, 85, 119)')
    const start = await text.boundingBox()
    if (!start) throw new Error('Missing text bounds')
    await page.mouse.move(start.x + 10, start.y + 10)
    await page.mouse.down()
    await page.mouse.move(start.x + 40, start.y + 40, { steps: 4 })
    await page.mouse.up()
    await page.getByTestId('html-layout-undo').click()
    await expect.poll(async() => (await text.boundingBox())?.y).toBeCloseTo(start.y, 0)
    await expect(text).toHaveCSS('color', 'rgb(255, 85, 119)')
  })

  test('source editing has draft undo and empty modal history never undoes the document behind it', async() => {
    const tail = page.locator('.mu-paragraph-content').filter({ hasText: '尾部说明' })
    await tail.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' - 文档改动')
    await expect(tail).toContainText('文档改动')
    await open()
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect(page.getByTestId('html-layout-editor')).toBeVisible()
    await expect(tail).toContainText('文档改动')
    await page.getByTestId('html-layout-source-tab').click()
    const source = page.getByTestId('html-layout-source')
    const before = await source.inputValue()
    await source.fill(before.replace('>屏蔽电感</span>', '>源码标注</span>'))
    await source.press('Control+z')
    await expect(source).toHaveValue(before)
    await source.press('Control+Shift+z')
    await expect(source).toHaveValue(before.replace('>屏蔽电感</span>', '>源码标注</span>'))
    await page.getByTestId('html-layout-visual-tab').click()
    await expect(page.getByTestId('html-layout-stage').locator('#caption-c')).toHaveText('源码标注')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.locator('.mu-html-preview #caption-c')).toHaveText('屏蔽电感')
    await expect(tail).toContainText('文档改动')
  })

  test('image size edits undo and redo the complete geometry transaction', async() => {
    await open()
    const before = await boxes()
    const image = page.getByTestId('html-layout-stage').locator('#image-a')
    await image.click()
    await page.getByTestId('html-layout-width').fill('70')
    await page.getByTestId('html-layout-width').press('Tab')
    await expect.poll(async() => (await image.boundingBox())?.width).toBeCloseTo(70, 0)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sameBoxes(before)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await expect.poll(async() => (await image.boundingBox())?.width).toBeCloseTo(70, 0)
    await page.getByTestId('html-layout-undo').click()
    await sameBoxes(before)
  })
})

import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import fs from 'node:fs/promises'
import { launchWithMarkdown, launchElectron, waitForEditor, getMarkdownContent, expectNoRendererErrors, sendIpcToRenderer } from './helpers'

const image = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="110"><rect width="200" height="110" rx="14" fill="#287cb8"/><path d="M40 55h25q10-30 20 0q10-30 20 0q10-30 20 0h30" fill="none" stroke="white" stroke-width="5"/></svg>').toString('base64')
const fixture = `# HTML 文字框\n\n<div id="text-demo" style="position:relative;width:640px;height:300px">\n<img id="original-image" src="${image}" style="position:absolute;left:20px;top:20px;width:200px;height:110px">\n<p id="original-caption" style="position:absolute;left:20px;top:160px;margin:0;color:red!important;font-size:18px">原有说明</p>\n</div>\n\n正文保持原样。\n`
const preferences = { language: 'zh-CN', theme: 'dark', followSystemTheme: false, fontSize: 17 }

test.describe('HTML layout text boxes', () => {
  let app: ElectronApplication
  let page: Page
  let filePath: string

  test.beforeEach(async() => {
    const launched = await launchWithMarkdown(fixture, { suppressErrorDialog: true, preferences })
    app = launched.app
    page = launched.page
    filePath = launched.filePath
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setSize(1440, 1000)
      window.webContents.setBackgroundThrottling(false)
      window.hide()
    })
  })

  test.afterEach(async() => {
    if (app) {
      await expectNoRendererErrors(app)
      await app.evaluate(({ BrowserWindow, app }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); app.exit(0) }).catch(() => {})
      await app.close().catch(() => {})
    }
  })

  const open = async() => {
    await page.locator('.mu-html-preview').hover()
    await page.getByRole('button', { name: '编辑 HTML 布局', exact: true }).click()
    await expect(page.getByTestId('html-layout-editor')).toBeVisible()
  }
  const stage = () => page.getByTestId('html-layout-stage')
  const add = async() => {
    await page.getByTestId('html-layout-add-text').click()
    await expect(page.getByTestId('html-layout-text')).toBeFocused()
    await expect(page.getByTestId('html-layout-text')).toHaveValue('新文字')
  }

  test('adds, edits, colors and sizes a whole text box without moving existing images', async() => {
    await open()
    const original = await stage().locator('#original-image').boundingBox()
    await add()
    await page.getByTestId('html-layout-text').fill('屏蔽电感说明')
    const font = page.getByTestId('html-layout-font-size')
    await font.fill('32')
    await font.press('Tab')
    await page.getByTestId('html-layout-text-color').fill('#ff5577')
    const text = stage().locator('#text-demo > span')
    await expect(text).toHaveText('屏蔽电感说明')
    await expect(text).toHaveCSS('font-size', '32px')
    await expect(text).toHaveCSS('color', 'rgb(255, 85, 119)')
    expect(await stage().locator('#original-image').boundingBox()).toEqual(original)
    const beforeMove = await text.boundingBox()
    if (!beforeMove) throw new Error('Text box has no visible bounds')
    await page.mouse.move(beforeMove.x + 12, beforeMove.y + 12)
    await page.mouse.down()
    await page.mouse.move(beforeMove.x + 42, beforeMove.y + 42, { steps: 4 })
    await page.mouse.up()
    const afterMove = await text.boundingBox()
    expect(afterMove?.x).toBeCloseTo(beforeMove.x + 30, 0)
    expect(afterMove?.y).toBeCloseTo(beforeMove.y + 30, 0)
    const pasteAllowed = await page.getByTestId('html-layout-text').evaluate(element => element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true })))
    expect(pasteAllowed).toBe(true)
    await page.getByTestId('html-layout-source-tab').click()
    const source = await page.getByTestId('html-layout-source').inputValue()
    expect(source).toContain('屏蔽电感说明')
    expect(source).toContain('font-size: 32px;')
    expect(source).toContain('color: #ff5577;')
    await page.getByTestId('html-layout-visual-tab').click()
    await stage().locator('#text-demo > span').click()
    await expect(page.getByTestId('html-layout-font-size')).toHaveValue('32')
    await page.getByTestId('html-layout-text-color').scrollIntoViewIfNeeded()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    await page.screenshot({ path: test.info().outputPath('html-text-box-controls.png'), animations: 'disabled' })
    await page.getByTestId('html-layout-apply').click()
    await expect(page.getByTestId('html-layout-editor')).toHaveCount(0)
    await expect(page.locator('.mu-html-preview #text-demo > span')).toHaveCSS('font-size', '32px')
    await expect(page.locator('.mu-html-preview #text-demo > span')).toHaveCSS('color', 'rgb(255, 85, 119)')
  })

  test('preserves empty and multiline text through source mode and reopening', async() => {
    await open()
    await add()
    const content = '第一行 <标签> &\n\n最后一行'
    await page.getByTestId('html-layout-text').fill(content)
    await page.getByTestId('html-layout-source-tab').click()
    expect(await page.getByTestId('html-layout-source').inputValue()).toContain('&#10;&#10;')
    await page.getByTestId('html-layout-visual-tab').click()
    await stage().locator('#text-demo > span').click()
    await expect(page.getByTestId('html-layout-text')).toHaveValue(content)
    await page.getByTestId('html-layout-text').fill('')
    await page.getByTestId('html-layout-apply').click()
    await open()
    const empty = stage().locator('#text-demo > span')
    await expect(empty).toBeVisible()
    await empty.click()
    await expect(page.getByTestId('html-layout-text')).toHaveValue('')
    await page.getByTestId('html-layout-text').fill('重新输入')
    await expect(empty).toHaveText('重新输入')
  })

  test('deletes only the selected text box and Cancel discards all draft changes', async() => {
    const before = await getMarkdownContent(page, app)
    await open()
    await add()
    await page.getByTestId('html-layout-delete-text').click()
    await expect(stage().locator('#text-demo > span')).toHaveCount(0)
    await expect(stage().locator('#original-image')).toBeVisible()
    await stage().locator('#original-caption').click()
    await page.getByTestId('html-layout-delete-text').click()
    await expect(stage().locator('#original-caption')).toHaveCount(0)
    await page.getByTestId('html-layout-cancel').click()
    expect(await getMarkdownContent(page, app)).toBe(before)
  })

  test('existing important text color changes survive Apply and reopening in Chromium', async() => {
    await open()
    await stage().locator('#original-caption').click()
    await page.getByTestId('html-layout-text-color').fill('#336699')
    await page.getByTestId('html-layout-apply').click()
    await expect(page.locator('.mu-html-preview #original-caption')).toHaveCSS('color', 'rgb(51, 102, 153)')
    await open()
    await expect(stage().locator('#original-caption')).toHaveCSS('color', 'rgb(51, 102, 153)')
    await stage().locator('#original-caption').click()
    await expect(page.getByTestId('html-layout-text-color')).toHaveValue('#336699')
  })

  test('applies text insertion as an undoable document change', async() => {
    await open()
    await add()
    await page.getByTestId('html-layout-text').fill('可以撤销')
    await page.getByTestId('html-layout-apply').click()
    await expect(page.locator('.mu-html-preview #text-demo > span')).toHaveText('可以撤销')
    await page.locator('.mu-content').first().click({ position: { x: 10, y: 10 } })
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect(page.locator('.mu-html-preview #text-demo > span')).toHaveCount(0)
  })

  test('saves text and styles to the note and reloads them in a fresh application profile', async() => {
    await open()
    await add()
    await page.getByTestId('html-layout-text').fill('保存后的说明')
    await page.getByTestId('html-layout-font-size').fill('28')
    await page.getByTestId('html-layout-font-size').press('Tab')
    await page.getByTestId('html-layout-text-color').fill('#5cbdaa')
    await page.getByTestId('html-layout-apply').click()
    await expect(page.getByTestId('html-layout-editor')).toHaveCount(0)
    expect(await getMarkdownContent(page, app)).toContain('保存后的说明')
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const save = Menu.getApplicationMenu()?.items.flatMap(item => item.submenu?.items ?? []).find(item => item.label.replace(/&/g, '') === '保存')
      if (!save) throw new Error('Save menu is unavailable')
      save.click(save, BrowserWindow.getAllWindows()[0], {})
    })
    await expect.poll(async() => (await fs.readFile(filePath, 'utf8')).includes('保存后的说明')).toBe(true)
    await app.evaluate(({ BrowserWindow, app }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
    const relaunched = await launchElectron([filePath], { suppressErrorDialog: true, preferences })
    app = relaunched.app
    page = relaunched.page
    await waitForEditor(page)
    await open()
    const text = stage().locator('#text-demo > span')
    await expect(text).toHaveText('保存后的说明')
    await expect(text).toHaveCSS('font-size', '28px')
    await expect(text).toHaveCSS('color', 'rgb(92, 189, 170)')
  })
})

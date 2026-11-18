import { expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from 'playwright'
import fs from 'node:fs/promises'
import { expectNoRendererErrors, getMarkdownContent, launchWithMarkdown, launchElectron, waitForEditor } from './helpers'

const image = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#287cb8"/></svg>').toString('base64')
const fixture = `# HTML 布局\n\n<div id="layout-frame" style="position:relative;width:650px;height:330px">\n<img id="original-image" src="${image}" style="position:absolute;left:20px;top:20px;width:160px;height:90px">\n<span id="caption" style="position:absolute;left:20px;top:140px">原有说明</span>\n<table id="parameters" style="position:absolute;left:210px;top:50px;width:350px;border-collapse:collapse"><thead><tr><th>项目</th><th>数值</th></tr></thead><tbody><tr><td>电压</td><td id="voltage">3.3 V</td></tr><tr><td>用途</td><td><strong>保留富文本</strong></td></tr></tbody></table>\n</div>\n\n尾部正文\n`
const preferences = { language: 'zh-CN', theme: 'dark', followSystemTheme: false }

async function drag(page: Page, target: Locator, fraction: number, x: number, y: number) {
  const box = await target.boundingBox()
  if (!box) throw new Error('The edge is outside the editor')
  const left = box.x + box.width * (x ? 0.5 : fraction)
  const top = box.y + box.height * (x ? fraction : 0.5)
  await page.mouse.move(left, top)
  await page.mouse.down()
  await page.mouse.move(left + x, top + y, { steps: 5 })
  await page.mouse.up()
}

test.describe('HTML table layout editor', () => {
  let app: ElectronApplication
  let page: Page
  let filePath: string
  const stage = () => page.getByTestId('html-layout-stage')
  const editor = () => page.getByTestId('html-layout-editor')
  const table = () => stage().locator('#parameters')
  const voltage = () => table().locator('tbody tr').first().locator('td').nth(1)

  async function open() {
    await page.locator('.mu-html-preview').hover()
    await page.getByRole('button', { name: '编辑 HTML 布局', exact: true }).click()
    await expect(editor()).toBeVisible()
    await expect(stage().locator('#parameters')).toBeVisible()
  }

  async function closeApp() {
    await app.evaluate(({ BrowserWindow, app }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
      app.exit(0)
    }).catch(() => {})
    await app.close().catch(() => {})
  }

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
    if (!app) return
    try { await expectNoRendererErrors(app) } finally { await closeApp() }
  })

  test('edits text and styles independently, supports blank-area undo, and saves them through a fresh launch', async() => {
    test.setTimeout(60_000)
    await open()
    await expect(page.getByTestId('html-layout-table-pick')).toHaveCount(0)
    await expect(page.getByTestId('html-layout-boundary')).toHaveCSS('border-top-style', 'solid')
    await voltage().click()
    const input = page.getByTestId('html-layout-text')
    await expect(input).toBeFocused()
    const originalHeight = await voltage().evaluate(el => el.getBoundingClientRect().height)
    await input.fill('第一行\n\n电压 <值> & 说明\n最后一行')
    expect(await voltage().evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(originalHeight + 20)
    const scope = page.getByTestId('html-layout-color-scope')
    await scope.selectOption('table')
    const fill = page.getByTestId('html-layout-fill-color')
    const position = await fill.boundingBox()
    await fill.fill('#3b815f')
    await expect(table().locator('th').first()).toHaveCSS('background-color', 'rgb(59, 129, 95)')
    await stage().locator('#layout-frame').click({ position: { x: 160, y: 270 } })
    await page.keyboard.press('Control+z')
    await expect(table().locator('th').first()).not.toHaveCSS('background-color', 'rgb(59, 129, 95)')
    await expect(page.getByTestId('html-layout-table-pick')).toHaveCount(0)
    await page.keyboard.press('Control+y')
    await expect(table().locator('th').first()).toHaveCSS('background-color', 'rgb(59, 129, 95)')
    await voltage().click()
    await editor().getByRole('button', { name: '线条色', exact: true }).click()
    const grid = page.getByTestId('html-layout-grid-color')
    expect(await grid.boundingBox()).toEqual(position)
    await grid.fill('#d98a42')
    await expect(table().locator('th').first()).toHaveCSS('border-top-color', 'rgb(217, 138, 66)')
    await editor().getByRole('button', { name: '字体', exact: true }).click()
    expect(await page.getByTestId('html-layout-text-color').boundingBox()).toEqual(position)
    await scope.selectOption('cell')
    await page.getByTestId('html-layout-text-color').fill('#ffd580')
    await expect(voltage()).toHaveCSS('color', 'rgb(255, 213, 128)')
    const selection = page.getByTestId('html-layout-selection')
    await expect(selection).toHaveCSS('border-top-style', 'dashed')
    const previousWidths = await table().locator('thead th').evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width))
    await drag(page, page.getByTestId('html-layout-table-right'), 0.24, -25, 0)
    const columnWidths = await table().locator('thead th').evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width))
    expect(columnWidths[0]).toBeCloseTo(previousWidths[0], 0)
    expect(columnWidths[1]).toBeCloseTo(previousWidths[1] - 25, 0)
    await page.getByTestId('html-layout-apply').click()
    await expect(editor()).toHaveCount(0)
    const html = await getMarkdownContent(page, app)
    expect(html).toContain('&#10;&#10;')
    expect(html).toContain('&lt;值&gt; &amp;')
    expect(html).toContain('<strong>保留富文本</strong>')
    expect(html).toContain('--mt-layout-grid-color: #d98a42')
    expect(html).toContain('<colgroup>')
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const save = Menu.getApplicationMenu()?.items.flatMap(item => item.submenu?.items ?? []).find(item => item.label.replace(/&/g, '') === '保存')
      if (!save) throw new Error('Save menu is unavailable')
      save.click(save, BrowserWindow.getAllWindows()[0], {})
    })
    await expect.poll(async() => (await fs.readFile(filePath, 'utf8')).includes('#d98a42')).toBe(true)
    await expectNoRendererErrors(app)
    await closeApp()
    const relaunched = await launchElectron([filePath], { suppressErrorDialog: true, preferences })
    app = relaunched.app
    page = relaunched.page
    await waitForEditor(page)
    await open()
    await expect(voltage()).toHaveCSS('border-top-color', 'rgb(217, 138, 66)')
    await expect(voltage()).toHaveCSS('background-color', 'rgb(59, 129, 95)')
    await voltage().click()
    await expect(page.getByTestId('html-layout-text')).toHaveValue('第一行\n\n电压 <值> & 说明\n最后一行')
  })

  test('adds and edits table structure, resizes a whole table and outer frame, and cancels without saving', async() => {
    test.setTimeout(60_000)
    const original = await getMarkdownContent(page, app)
    await open()
    await voltage().click()
    const rowHeights = () => table().locator('tr').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height))
    const heights = await rowHeights()
    await drag(page, page.getByTestId('html-layout-table-bottom'), 0.35, 0, 42)
    const resized = await rowHeights()
    expect(resized[0]).toBeCloseTo(heights[0], 0)
    expect(resized[1]).toBeCloseTo(heights[1] + 42, 0)
    expect(resized[2]).toBeCloseTo(heights[2], 0)
    await page.getByTestId('html-layout-table-pick').click()
    const width = await table().evaluate(el => el.getBoundingClientRect().width)
    await drag(page, page.getByTestId('html-layout-table-right'), 0.28, 26, 0)
    await expect.poll(() => table().evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(width + 26, 0)
    await page.getByTestId('html-layout-add-row').click()
    await expect(table().locator('tr')).toHaveCount(4)
    await page.getByTestId('html-layout-add-column').click()
    await expect(table().locator('tr').first().locator('th')).toHaveCount(3)
    await page.getByTestId('html-layout-add-table').click()
    await expect(stage().locator('table')).toHaveCount(2)
    const imageGeometry = () => stage().locator('#original-image').evaluate(img => {
      const rect = img.getBoundingClientRect()
      const frame = img.closest('#layout-frame')!.getBoundingClientRect()
      return [rect.left - frame.left, rect.top - frame.top, rect.width, rect.height]
    })
    const before = await imageGeometry()
    await editor().getByRole('button', { name: 'HTML 外框', exact: true }).click()
    const widthField = page.getByTestId('html-layout-width')
    const outward = Number(await widthField.inputValue()) + 40
    await widthField.fill(String(outward))
    await widthField.press('Enter')
    await expect(widthField).toHaveValue(String(outward))
    await drag(page, page.getByTestId('html-layout-frame-right'), 0.27, 30, 0)
    await expect(widthField).toHaveValue(String(outward + 30))
    const heightField = page.getByTestId('html-layout-height')
    const height = Number(await heightField.inputValue())
    await drag(page, page.getByTestId('html-layout-resize-bottom'), 0.2, 0, 44)
    await expect(heightField).toHaveValue(String(height + 44))
    const after = await imageGeometry()
    after.forEach((value, index) => expect(value).toBeCloseTo(before[index]!, 1))
    await page.getByTestId('html-layout-cancel').click()
    expect(await getMarkdownContent(page, app)).toBe(original)
  })

  test('orders overlapping objects without moving them and keeps edited palette slots', async() => {
    test.setTimeout(60_000)
    await open()
    await voltage().click()
    await editor().getByText('编辑常用色槽', { exact: true }).click()
    await editor().getByLabel('色值', { exact: true }).fill('#315570')
    await editor().getByRole('button', { name: '保存色槽', exact: true }).click()
    const swatch = editor().getByRole('button', { name: '常用色 1 #315570', exact: true })
    await expect(swatch).toBeVisible()
    const moveHandle = page.getByTestId('html-layout-table-pick')
    await drag(page, moveHandle, 0.5, 250, 0)
    const margin = await table().evaluate(el => el.closest('#layout-frame')!.getBoundingClientRect().right - el.getBoundingClientRect().right)
    expect(margin).toBeCloseTo(0, 0)
    await page.getByTestId('html-layout-undo').click()
    await drag(page, moveHandle, 0.5, -95, 0)

    const hit = () => stage().locator('#layout-frame').evaluate(frame => {
      const { left, top } = frame.getBoundingClientRect()
      return document.elementFromPoint(left + 155, top + 76)?.closest('#original-image, #parameters')?.id
    })
    await expect.poll(hit).toBe('parameters')
    await editor().getByLabel('对象操作', { exact: true }).click()
    const before = await table().boundingBox()
    await page.getByTestId('html-layout-next').click()
    await page.getByTestId('html-layout-next').click()
    await expect.poll(hit).toBe('original-image')
    expect(await table().boundingBox()).toEqual(before)
    await page.getByTestId('html-layout-apply').click()
    await expect(editor()).toHaveCount(0)
    await open()
    await expect.poll(hit).toBe('original-image')
    await voltage().click()
    await expect(swatch).toBeVisible()
  })
})

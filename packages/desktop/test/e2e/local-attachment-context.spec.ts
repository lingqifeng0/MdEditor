import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { expectNoRendererErrors, launchWithMarkdown } from './helpers'

test.describe('Local attachment context menu', () => {
  let app: ElectronApplication
  let page: Page
  let directory: string
  const state = () => app.evaluate(() => (globalThis as typeof globalThis & { __attachmentContext: { menus: string[][]; files: string[] } }).__attachmentContext)

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# 附件\n\n[参考工程](assets/%E5%8F%82%E8%80%83%20%E5%B7%A5%E7%A8%8B.epro)\n\n[图片附件](assets/diagram.png#view)\n\n[安装包](assets/setup.exe)\n\n[缺失附件](assets/missing.epro)\n\n[网址](https://example.com)\n\n[章节](#section)\n', {
      suppressErrorDialog: true,
      preferences: { language: 'zh-CN' }
    })
    app = launched.app
    page = launched.page
    directory = path.dirname(launched.filePath)
    fs.mkdirSync(path.join(directory, 'assets'))
    for (const name of ['参考 工程.epro', 'diagram.png', 'setup.exe']) fs.writeFileSync(path.join(directory, 'assets', name), 'test attachment only')
    await app.evaluate(({ Menu, shell }) => {
      const context = { menus: [] as string[][], files: [] as string[] }
      ;(globalThis as typeof globalThis & { __attachmentContext: typeof context }).__attachmentContext = context
      shell.showItemInFolder = filename => { context.files.push(filename) }
      Menu.prototype.popup = function(options) {
        context.menus.push(this.items.map(item => item.label))
        if (this.items[0]?.label === '打开所在文件夹') this.items[0].click(this.items[0], options?.window, {} as Electron.KeyboardEvent)
        options?.callback?.()
      }
    })
  })

  test.afterAll(async() => {
    if (!app) return
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy() })
    await app.close()
  })

  test('right-clicking assets attachments reveals their exact files through the native menu action', async() => {
    for (const [index, label, name] of [[0, '参考工程', '参考 工程.epro'], [1, '图片附件', 'diagram.png'], [2, '安装包', 'setup.exe']] as const) {
      const before = await state()
      await page.locator('.mu-link').filter({ hasText: label }).click({ button: 'right' })
      await expect.poll(async() => (await state()).files.length).toBe(index + 1)
      const after = await state()
      expect(after.files[index]).toBe(path.join(directory, 'assets', name))
      expect(after.menus.slice(before.menus.length)).toEqual([['打开所在文件夹']])
    }
  })

  test('missing attachments report the missing file without opening a wrong directory', async() => {
    const before = (await state()).files.length
    await page.locator('.mu-link').filter({ hasText: '缺失附件' }).click({ button: 'right' })
    await expect(page.getByText('链接对应的本地文件不存在或无法访问。', { exact: true })).toBeVisible()
    expect((await state()).files).toHaveLength(before)
  })

  test('web links and anchors keep the regular context menu, and unsaved relative paths are rejected', async() => {
    for (const label of ['网址', '章节']) {
      const before = await state()
      await page.locator('.mu-link').filter({ hasText: label }).click({ button: 'right' })
      await expect.poll(async() => (await state()).menus.length).toBeGreaterThan(before.menus.length)
      expect((await state()).menus.at(-1)).not.toContain('打开所在文件夹')
    }
    const invalid = await page.evaluate(() => window.electron.ipcRenderer.invoke('mt::shell::reveal-link', 'assets/relative.epro', ''))
    expect(invalid.ok).toBe(false)
    await expectNoRendererErrors(app)
  })
})

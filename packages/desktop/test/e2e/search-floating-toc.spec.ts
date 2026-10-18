import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, sendIpcToRenderer, expectNoRendererErrors } from './helpers'

test.describe('Document search beside floating TOC', () => {
  let app: ElectronApplication
  let page: Page
  let fixedTop: number
  const markdown = Array.from({ length: 30 }, (_, i) => `## Section ${i + 1}\n\nResistor 1% (E24/E96) specification ${i + 1}.\n`).join('\n')

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(markdown, {
      suppressErrorDialog: true,
      preferences: { floatingTocEnabled: true, floatingTocPinned: false }
    })
    app = launched.app
    page = launched.page
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
  })

  test.afterAll(async() => { if (app) await app.close() })

  const openFind = async() => {
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'find')
    await expect(page.locator('.search-bar')).toBeVisible()
    await expect(page.locator('.floating-toc')).toBeVisible()
  }

  const expectSeparate = async() => {
    await expect.poll(async() => {
      const search = await page.locator('.search-bar').boundingBox()
      const toc = await page.locator('.floating-toc').boundingBox()
      return !!search && !!toc && toc.y >= search.y + search.height + 8
    }).toBe(true)
  }

  const expectFixed = async() => {
    await expect.poll(async() => (await page.locator('.floating-toc').boundingBox())?.y).toBe(fixedTop)
  }

  test('TOC stays at the same fixed lower position before and during search', async() => {
    await expect(page.locator('.floating-toc')).toBeVisible()
    const initialBox = await page.locator('.floating-toc').boundingBox()
    if (!initialBox) throw new Error('Floating TOC is not visible')
    fixedTop = initialBox.y
    await openFind()
    await expectFixed()
    await expectSeparate()
    await page.locator('.search-bar input').first().fill('1% (E24/E96)')
    await expect(page.locator('.search-bar .search-result')).toContainText('/ 30')
    await page.locator('.floating-toc').hover()
    await expect(page.locator('.floating-toc')).toHaveClass(/expanded/)
    await expectSeparate()
    await expectFixed()
    await page.locator('.floating-toc [data-toc-action="pin"]').click()
    await page.mouse.move(20, 20)
    await expect(page.locator('.floating-toc')).toHaveClass(/pinned/)
    await expect(page.locator('.search-bar')).toBeVisible()
    await expect(page.locator('.search-bar input').first()).toHaveValue('1% (E24/E96)')
    await page.screenshot({ path: process.env.MARKTEXT_SEARCH_SCREENSHOT || '../../../validation/search-overlap-20261014/search-toc-separated.png' })
  })

  test('native input drag released outside the bar keeps the search draft', async() => {
    const input = page.locator('.search-bar input').first()
    await input.fill('1% (E24/E96)')
    const box = await input.boundingBox()
    if (!box) throw new Error('Find input is not visible')
    await page.mouse.move(box.x + 55, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x - 70, box.y + box.height + 40, { steps: 12 })
    await page.mouse.up()
    await expect(page.locator('.search-bar')).toBeVisible()
    await expect(input).toHaveValue('1% (E24/E96)')
    await input.evaluate((node: HTMLInputElement) => { node.focus(); node.setSelectionRange(0, 2) })
    await page.keyboard.insertText('0.1')
    await expect(input).toHaveValue('0.1 (E24/E96)')
    await page.locator('.mu-editor').click({ position: { x: 50, y: 220 } })
    await expect(page.locator('.search-bar')).toBeVisible()
    await expect(input).toHaveValue('0.1 (E24/E96)')
  })

  test('replace mode and window resizing keep search and TOC separate', async() => {
    await page.locator('.search-bar .left-arrow').click()
    await expect(page.locator('.search-bar .replace')).toBeVisible()
    await page.locator('.search-bar .replace input').fill('replacement text')
    await expectSeparate()
    await expectFixed()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 620))
    await expectSeparate()
    await expectFixed()
    await expect(page.locator('.search-bar input').first()).toHaveValue('0.1 (E24/E96)')
    await page.locator('.floating-toc [data-toc-action="pin"]').click()
    await page.mouse.move(20, 20)
    await expect(page.locator('.floating-toc')).not.toHaveClass(/expanded/)
    await expectSeparate()
  })

  test('close and Escape retain both drafts when reopened', async() => {
    const input = page.locator('.search-bar input').first()
    await page.locator('.search-bar .close-search').click()
    await expect(page.locator('.search-bar')).toBeHidden()
    await expectFixed()
    await page.locator('.mu-editor').click({ position: { x: 45, y: 200 } })
    await openFind()
    await expect(input).toHaveValue('0.1 (E24/E96)')
    await page.locator('.search-bar .left-arrow').click()
    await expect(page.locator('.search-bar .replace input')).toHaveValue('replacement text')
    await input.focus()
    await page.keyboard.press('Escape')
    await expect(page.locator('.search-bar')).toBeHidden()
    await expectFixed()
    await openFind()
    await expect(input).toHaveValue('0.1 (E24/E96)')
    await expectSeparate()
    await expectNoRendererErrors(app)
  })
})

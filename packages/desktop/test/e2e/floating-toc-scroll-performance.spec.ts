import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown } from './helpers'

const headingSelector = '.mu-container > h1, .mu-container > h2, .mu-container > h3, .mu-container > h4, .mu-container > h5, .mu-container > h6'

test.describe('Floating directory scrolling', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const sections = Array.from({ length: 80 }, (_, index) => `## Section ${index}\n\n${'Long body text keeps the section positions realistic. '.repeat(18)}\n\n`).join('')
    const launched = await launchWithMarkdown(`# Document\n\n${sections}`, {
      suppressErrorDialog: true,
      preferences: { floatingTocEnabled: true, floatingTocPinned: true, theme: 'dark' }
    })
    app = launched.app
    page = launched.page
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900))
    await page.waitForTimeout(250)
  })

  test.afterAll(async() => { if (app) await app.close() })

  test('keeps the active row accurate without measuring every heading on scroll', async() => {
    await page.evaluate((selector) => {
      const original = Element.prototype.getBoundingClientRect
      let count = 0
      Object.defineProperty(window, '__floatingTocScrollProbe', {
        configurable: true,
        value: { original, get count() { return count } }
      })
      Element.prototype.getBoundingClientRect = function() {
        if (this.matches?.(selector)) count++
        return original.call(this)
      }
    }, headingSelector)

    const editor = page.locator('.mu-editor')
    const scrollPositions = [400, 1200, 2400, 3600, 5200, 6800]
    for (const top of scrollPositions) {
      await editor.evaluate((element, scrollTop) => { element.scrollTop = scrollTop }, top)
      await page.waitForTimeout(25)
    }

    const headingReads = await page.evaluate(() => {
      const probe = (window as unknown as { __floatingTocScrollProbe: { original: typeof Element.prototype.getBoundingClientRect; count: number } }).__floatingTocScrollProbe
      Element.prototype.getBoundingClientRect = probe.original
      return probe.count
    })
    expect(headingReads).toBeLessThanOrEqual(2)

    for (const top of scrollPositions) {
      await editor.evaluate((element, scrollTop) => { element.scrollTop = scrollTop }, top)
      const readState = () => page.evaluate((selector) => {
        const editor = document.querySelector<HTMLElement>('.mu-editor')
        const headings = [...document.querySelectorAll<HTMLElement>(selector)]
        if (!editor || !headings.length) return null
        const viewportTop = editor.getBoundingClientRect().top + 25
        let expected = headings[0]
        for (const heading of headings) {
          if (heading.getBoundingClientRect().top > viewportTop) break
          expected = heading
        }
        return {
          expected: expected.textContent?.replace(/^#+\s*/, '').trim(),
          active: document.querySelector<HTMLElement>('.floating-toc li.active')?.textContent?.replace(/H[1-6]/, '').trim()
        }
      }, headingSelector)
      const expected = (await readState())?.expected
      await expect.poll(async() => (await readState())?.active).toBe(expected)
    }
  })
})

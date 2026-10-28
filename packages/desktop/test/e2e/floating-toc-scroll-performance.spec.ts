import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { enterSourceMode, exitSourceMode, expectNoRendererErrors, launchWithMarkdown } from './helpers'

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

  test.afterAll(async() => {
    if (!app) return
    try { await expectNoRendererErrors(app) } finally { await app.close() }
  })

  const collapsePanel = async() => {
    const toc = page.locator('.floating-toc')
    if ((await toc.getAttribute('class'))?.includes('pinned')) await toc.locator('[data-toc-action="pin"]').click()
    await page.mouse.move(40, 40)
    await expect(toc).not.toHaveClass(/expanded/)
  }

  const scrollToHeading = async(index: number) => {
    await page.evaluate(({ selector, index }) => {
      const editor = document.querySelector<HTMLElement>('.mu-editor')
      const heading = document.querySelectorAll<HTMLElement>(selector)[index]
      if (!editor || !heading) throw new Error('Editor heading is missing')
      editor.scrollTop += heading.getBoundingClientRect().top - editor.getBoundingClientRect().top
    }, { selector: headingSelector, index })
    await expect(page.locator('.floating-toc li.active .toc-heading')).toHaveAttribute('data-heading-index', String(index))
  }

  const compactState = () => page.locator('.floating-toc').evaluate(nav => {
    const list = nav.querySelector<HTMLElement>('.toc-rail')
    const row = list?.querySelector<HTMLElement>('li.active')
    const stroke = row?.querySelector<HTMLElement>('.toc-stroke')
    if (!list || !row || !stroke) throw new Error('Compact reading-position marker is missing')
    const viewport = list.getBoundingClientRect()
    const bounds = row.getBoundingClientRect()
    const probe = document.createElement('span')
    probe.style.color = 'var(--themeColor)'
    nav.appendChild(probe)
    const theme = getComputedStyle(probe).color
    probe.remove()
    return {
      slug: row.dataset.tocSlug,
      scrollTop: list.scrollTop,
      top: bounds.top - viewport.top,
      bottom: bounds.bottom - viewport.top,
      height: list.clientHeight,
      color: getComputedStyle(stroke).backgroundColor,
      theme
    }
  })

  const expectBlueMarkerVisible = async() => {
    const state = await compactState()
    expect(state.color).toBe(state.theme)
    expect(state.top).toBeGreaterThanOrEqual(0)
    expect(state.bottom).toBeLessThanOrEqual(state.height)
    return state
  }

  test('keeps the active row accurate without measuring every heading on scroll', async() => {
    await page.evaluate((selector) => {
      const original = Element.prototype.getBoundingClientRect
      const originalQuerySelectorAll = Element.prototype.querySelectorAll
      let count = 0
      let rowQueries = 0
      Object.defineProperty(window, '__floatingTocScrollProbe', {
        configurable: true,
        value: { original, originalQuerySelectorAll, get count() { return count }, get rowQueries() { return rowQueries } }
      })
      Element.prototype.getBoundingClientRect = function() {
        if (this.matches?.(selector)) count++
        return original.call(this)
      }
      Element.prototype.querySelectorAll = function(selector: string) {
        if (selector === '[data-toc-slug]') rowQueries++
        return originalQuerySelectorAll.call(this, selector)
      }
    }, headingSelector)

    const editor = page.locator('.mu-editor')
    const scrollPositions = [400, 1200, 2400, 3600, 5200, 6800]
    for (let round = 0; round < 8; round++) {
      for (const top of scrollPositions) {
        await editor.evaluate((element, scrollTop) => { element.scrollTop = scrollTop }, top)
        await page.waitForTimeout(25)
      }
    }

    const probe = await page.evaluate(() => {
      const probe = (window as unknown as { __floatingTocScrollProbe: { original: typeof Element.prototype.getBoundingClientRect; originalQuerySelectorAll: typeof Element.prototype.querySelectorAll; count: number; rowQueries: number } }).__floatingTocScrollProbe
      Element.prototype.getBoundingClientRect = probe.original
      Element.prototype.querySelectorAll = probe.originalQuerySelectorAll
      return { headingReads: probe.count, rowQueries: probe.rowQueries }
    })
    expect(probe.headingReads).toBeLessThanOrEqual(2)
    expect(probe.rowQueries).toBe(0)

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
      const row = await page.locator('.floating-toc li.active').boundingBox()
      const list = await page.locator('.floating-toc .toc-list').boundingBox()
      if (!row || !list) throw new Error('Expanded active row is missing')
      expect(row.y).toBeGreaterThanOrEqual(list.y - 1)
      expect(row.y + row.height).toBeLessThanOrEqual(list.y + list.height + 1)
    }
  })

  test('keeps the active stroke blue and follows it when the compact rail is full', async() => {
    await collapsePanel()
    await scrollToHeading(0)
    const first = await expectBlueMarkerVisible()
    await scrollToHeading(5)
    expect((await expectBlueMarkerVisible()).scrollTop).toBe(first.scrollTop)
    for (const index of [25, 50, 79, 80, 55, 20, 0]) {
      await scrollToHeading(index)
      const state = await expectBlueMarkerVisible()
      if (index >= 50) expect(state.scrollTop).toBeGreaterThan(0)
      if (index === 0) expect(state.scrollTop).toBe(0)
    }
  })

  test('preserves the blue marker through hover cycles and follows reading changes while expanded', async() => {
    await collapsePanel()
    await scrollToHeading(60)
    const toc = page.locator('.floating-toc')
    const before = await expectBlueMarkerVisible()
    for (let cycle = 0; cycle < 4; cycle++) {
      await toc.hover()
      await expect(toc).toHaveClass(/expanded/)
      await toc.locator('.toc-list').evaluate(element => { element.scrollTop = 0 })
      await page.mouse.move(40, 40)
      await expect(toc).not.toHaveClass(/expanded/)
      const after = await expectBlueMarkerVisible()
      expect(after.slug).toBe(before.slug)
      expect(after.scrollTop).toBe(before.scrollTop)
      expect(after.top).toBe(before.top)
    }
    await toc.hover()
    await scrollToHeading(75)
    await page.mouse.move(40, 40)
    await expect(toc).not.toHaveClass(/expanded/)
    const afterReading = await expectBlueMarkerVisible()
    expect(afterReading.slug).not.toBe(before.slug)
    expect(afterReading.scrollTop).toBeGreaterThan(before.scrollTop)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 650))
    await expect.poll(async() => (await compactState()).height).toBeLessThan(afterReading.height)
    await expect.poll(async() => {
      const state = await compactState()
      return state.bottom <= state.height
    }).toBe(true)
    await expectBlueMarkerVisible()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900))
  })

  test('keeps every compact chapter and its blue marker when expanded branches are folded or searched', async() => {
    await collapsePanel()
    await scrollToHeading(50)
    const toc = page.locator('.floating-toc')
    await toc.hover()
    await toc.locator('[data-toc-action="collapse-all"]').click()
    await expect(toc.locator('li')).toHaveCount(1)
    await page.mouse.move(40, 40)
    await expect(toc.locator('.toc-rail li')).toHaveCount(81)
    await expectBlueMarkerVisible()
    await toc.hover()
    await toc.locator('[data-toc-action="search"]').click()
    await toc.locator('input[type="search"]').fill('Section 70')
    await page.locator('.mu-editor').click({ position: { x: 80, y: 50 } })
    await expect(toc).not.toHaveClass(/expanded/)
    await scrollToHeading(65)
    await expectBlueMarkerVisible()
    await toc.hover()
    await toc.locator('input[type="search"]').press('Escape')
    await toc.locator('[data-toc-action="expand-all"]').click()
    await collapsePanel()
  })

  test('tracks real wheel scrolling without full heading scans or compact row rectangle reads', async() => {
    await collapsePanel()
    await scrollToHeading(0)
    await page.waitForTimeout(250)
    await page.mouse.move(450, 400)
    await page.evaluate((selector) => {
      const original = Element.prototype.getBoundingClientRect
      let headingReads = 0
      let railReads = 0
      let frameReads = 0
      let peakFrameReads = 0
      let frame: number
      const resetFrame = () => { frameReads = 0; frame = requestAnimationFrame(resetFrame) }
      frame = requestAnimationFrame(resetFrame)
      Object.defineProperty(window, '__compactWheelProbe', {
        configurable: true,
        value: { original, stop: () => cancelAnimationFrame(frame), get headingReads() { return headingReads }, get railReads() { return railReads }, get peakFrameReads() { return peakFrameReads } }
      })
      Element.prototype.getBoundingClientRect = function() {
        if (this.matches?.(selector)) {
          headingReads++
          peakFrameReads = Math.max(peakFrameReads, ++frameReads)
        }
        if (this.matches?.('.toc-rail, .toc-rail li')) railReads++
        return original.call(this)
      }
    }, headingSelector)
    for (const direction of [1, -1, 1]) {
      for (let step = 0; step < 25; step++) {
        await page.mouse.wheel(0, direction * 620)
        await page.waitForTimeout(18)
      }
    }
    const reads = await page.evaluate(() => {
      const probe = (window as unknown as { __compactWheelProbe: { original: typeof Element.prototype.getBoundingClientRect; stop: () => void; headingReads: number; railReads: number; peakFrameReads: number } }).__compactWheelProbe
      probe.stop()
      Element.prototype.getBoundingClientRect = probe.original
      return { headings: probe.headingReads, rail: probe.railReads, peakFrameReads: probe.peakFrameReads }
    })
    // The editor's paragraph hover control may read its one reference heading.
    // An outline-wide measurement would instead read all 81 in one frame.
    expect(reads.peakFrameReads).toBeLessThanOrEqual(8)
    expect(reads.rail).toBe(0)
    const editorTop = await page.locator('.mu-editor').evaluate(element => element.scrollTop)
    expect(editorTop).toBeGreaterThan(10000)
    await expectBlueMarkerVisible()
  })

  test('recalibrates the blue marker after an image changes the document layout', async() => {
    await collapsePanel()
    await scrollToHeading(60)
    const expectCurrentHeading = async() => {
      await expect.poll(() => page.evaluate((selector) => {
        const editor = document.querySelector<HTMLElement>('.mu-editor')
        const headings = [...document.querySelectorAll<HTMLElement>(selector)]
        if (!editor || !headings.length) return false
        const threshold = editor.getBoundingClientRect().top + 25
        let expected = 0
        for (let index = 0; index < headings.length; index++) {
          if (headings[index].getBoundingClientRect().top > threshold) break
          expected = index
        }
        const actual = document.querySelector<HTMLElement>('.toc-rail li.active .toc-heading')?.dataset.headingIndex
        return actual === String(expected)
      }, headingSelector)).toBe(true)
      await expectBlueMarkerVisible()
    }
    try {
      await page.evaluate(() => {
        const image = document.createElement('img')
        image.id = 'toc-image-layout-probe'
        image.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFOsAAAAASUVORK5CYII='
        image.style.cssText = 'display:block;width:100px;height:1200px'
        document.querySelector('.mu-container > h1')?.after(image)
      })
      await expectCurrentHeading()
      await page.locator('#toc-image-layout-probe').evaluate(image => { (image as HTMLElement).style.height = '2200px' })
      await expectCurrentHeading()
    } finally {
      await page.locator('#toc-image-layout-probe').evaluate(image => image.remove())
    }
    await expectCurrentHeading()
  })

  test('keeps the compact marker accurate in source mode and after returning to the rendered note', async() => {
    await collapsePanel()
    await enterSourceMode(page, app)
    for (const index of [0, 40, 70]) {
      await page.locator('.source-code').evaluate((container, index) => {
        const headings = [...container.querySelectorAll<HTMLElement>('.CodeMirror-line')].filter(line => /^#{1,6}\s/.test(line.textContent ?? ''))
        const heading = headings[index]
        if (!heading) throw new Error('Source heading is missing')
        container.scrollTop += heading.getBoundingClientRect().top - container.getBoundingClientRect().top
      }, index)
      await expect(page.locator('.toc-rail li.active .toc-heading')).toHaveAttribute('data-heading-index', String(index))
      await expectBlueMarkerVisible()
    }
    await exitSourceMode(page, app)
    await scrollToHeading(50)
    await expectBlueMarkerVisible()
  })
})

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { enterSourceMode, exitSourceMode, expectNoRendererErrors, getMarkdownContent, launchWithMarkdown, sendIpcToRenderer } from './helpers'

test.describe('Floating directory hierarchy and source colors', () => {
  let app: ElectronApplication
  let page: Page
  const markdown = '# <span style="color:#3498ff">PCB_阻抗匹配参数计算</span>\n\n## 阅读目录与回看时间轴\n\n## 000336.050 本项目需要准备哪三种阻抗规则\n\n正文。\n\n### <span style="color:#e53935">提问：什么是差分，什么是单端</span>\n\n解释。\n\n#### 状态切换与<span style="color:#3498ff">电压判读</span>\n\n说明。\n\n##### 差分 P / N 的波形变化\n\n结论。\n\n###### 第六级标题\n\n说明。\n\n## 后续内容\n\n' + '用于验证滚动定位的后续正文。\n\n'.repeat(35)
  const toc = () => page.locator('.floating-toc')
  const row = (text: string) => toc().locator('li').filter({ has: page.locator('.toc-label', { hasText: text }) })

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(markdown, {
      suppressErrorDialog: true,
      preferences: { floatingTocEnabled: true, floatingTocPinned: true, theme: 'dark' }
    })
    app = launched.app
    page = launched.page
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900))
  })
  test.afterAll(async() => { if (app) await app.close() })

  test('levels sit on the left, wrapped labels align left and nested headings use compact indentation', async() => {
    await expect(toc()).toHaveClass(/expanded/)
    await expect(toc().locator('.toc-level')).toHaveText(['H1', 'H2', 'H2', 'H3', 'H4', 'H5', 'H6', 'H2'])
    const layout = await toc().locator('li').evaluateAll(items => items.map(item => {
      const label = item.querySelector('.toc-label')
      const badge = item.querySelector('.toc-level')
      if (!label || !badge) throw new Error('Heading label or level is missing')
      return { text: label.textContent, x: label.getBoundingClientRect().left, badgeRight: badge.getBoundingClientRect().right, align: getComputedStyle(label).textAlign }
    }))
    expect(layout.every(item => item.x > item.badgeRight && item.align === 'left')).toBe(true)
    expect(layout[1].x).toBe(layout[2].x)
    expect(layout[2].x - layout[2].badgeRight).toBeLessThanOrEqual(20)
    expect(layout[3].x - layout[2].x).toBe(8)
    expect(layout[4].x - layout[3].x).toBe(8)
    expect(layout[5].x - layout[4].x).toBe(8)
  })

  test('uses six badge colors, matches document heading colors and keeps a neutral current-row overlay', async() => {
    const colors = await toc().locator('.toc-level').evaluateAll(badges => badges.slice(0, 7).map(badge => getComputedStyle(badge).color))
    expect(new Set(colors).size).toBe(6)
    expect([colors[0], colors[1], colors[3], colors[4], colors[5], colors[6]]).toEqual(['rgb(114, 183, 255)', 'rgb(117, 203, 215)', 'rgb(164, 207, 154)', 'rgb(226, 202, 128)', 'rgb(238, 170, 118)', 'rgb(237, 137, 136)'])
    await expect(row('第六级标题').locator('.toc-level')).toHaveCSS('font-weight', '600')
    const h2 = row('阅读目录与回看时间轴')
    const h2Color = await h2.locator('.toc-heading').evaluate(button => getComputedStyle(button).color)
    const documentColor = await page.locator('.mu-container > h2').first().evaluate(heading => getComputedStyle(heading).color)
    expect(h2Color).toBe(documentColor)
    const h2Badge = await h2.locator('.toc-level').evaluate(badge => getComputedStyle(badge).color)
    await h2.locator('.toc-heading').click()
    await expect(h2).toHaveClass(/active/)
    await expect(h2.locator('.toc-heading')).toHaveCSS('color', h2Color)
    const background = await h2.evaluate(element => getComputedStyle(element).backgroundImage)
    expect(background).toContain('rgba(255, 255, 255, 0.1)')
    expect(await h2.evaluate(element => getComputedStyle(element, '::before').content)).toBe('none')
    await expect(h2.locator('.toc-level')).toHaveCSS('color', h2Badge)
  })

  test('whole and partial HTML colors survive navigation and the active heading highlight', async() => {
    const red = row('提问：').locator('.toc-label > span')
    await expect(red).toHaveCSS('color', 'rgb(229, 57, 53)')
    await row('提问：').locator('.toc-heading').click()
    await expect(row('提问：')).toHaveClass(/active/)
    await expect(red).toHaveCSS('color', 'rgb(229, 57, 53)')
    await expect(row('状态切换').locator('.toc-label > span').last()).toHaveCSS('color', 'rgb(52, 152, 255)')
    await expect(row('状态切换').locator('.toc-label')).toHaveText('状态切换与电压判读')
    await page.screenshot({ path: process.env.MARKTEXT_OUTLINE_SCREENSHOT || '../../../validation/outline-icon-20261018/floating-toc-final.png' })
    await toc().screenshot({ path: process.env.MARKTEXT_OUTLINE_DETAIL_SCREENSHOT || '../../../validation/outline-icon-20261018/floating-toc-detail.png' })
  })

  test('folding, directory search and document search preserve colored entries and the fixed position', async() => {
    await row('000336.050').locator('.toc-branch').click()
    await expect(row('提问：')).toHaveCount(0)
    await toc().locator('[data-toc-action="search"]').click()
    await toc().locator('input[type="search"]').fill('提问')
    await expect(row('提问：')).toBeVisible()
    await expect(row('提问：')).toHaveClass(/search-match/)
    await expect(row('提问：').locator('.toc-label > span')).toHaveCSS('color', 'rgb(229, 57, 53)')
    await toc().locator('input[type="search"]').press('Escape')
    await toc().locator('[data-toc-action="expand-all"]').click()
    const initialBox = await toc().boundingBox()
    if (!initialBox) throw new Error('Floating directory is missing')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'find')
    await expect(page.locator('.search-bar')).toBeVisible()
    expect((await toc().boundingBox())?.y).toBe(initialBox.y)
    await page.locator('.search-bar .close-search').click()
  })

  test('the panel stays visually uniform over black and white content, with rows reaching both inner edges', async() => {
    await toc().evaluate(nav => {
      const backdrop = document.createElement('div')
      backdrop.id = 'toc-background-probe'
      Object.assign(backdrop.style, { position: 'absolute', inset: '0', zIndex: '19', background: '#000', pointerEvents: 'none' })
      nav.parentElement?.appendChild(backdrop)
    })
    try {
      const box = await toc().boundingBox()
      if (!box) throw new Error('Floating directory is missing')
      const surface = { x: box.x + 2, y: box.y + 12, width: box.width - 4, height: box.height - 24 }
      const control = { x: box.x - 16, y: box.y + 20, width: 8, height: 20 }
      const blackPanel = await page.screenshot({ clip: surface, animations: 'disabled' })
      const blackOutside = await page.screenshot({ clip: control, animations: 'disabled' })
      await page.locator('#toc-background-probe').evaluate(node => { (node as HTMLElement).style.background = '#fff' })
      const whitePanel = await page.screenshot({ clip: surface, animations: 'disabled' })
      const whiteOutside = await page.screenshot({ clip: control, animations: 'disabled' })
      expect(blackOutside.equals(whiteOutside)).toBe(false)
      expect(blackPanel.equals(whitePanel)).toBe(true)
      const edgeGaps = await toc().evaluate(nav => {
        const box = nav.getBoundingClientRect()
        return [...nav.querySelectorAll('.toc-list li')].map(row => {
          const bounds = row.getBoundingClientRect()
          return { left: bounds.left - box.left - nav.clientLeft, right: box.right - bounds.right - nav.clientLeft }
        })
      })
      expect(edgeGaps.every(gap => Math.abs(gap.left) < 0.5 && Math.abs(gap.right) < 0.5)).toBe(true)
      await toc().evaluate(nav => {
        const backdrop = document.getElementById('toc-background-probe')
        const panel = nav as HTMLElement
        const split = panel.offsetTop + panel.offsetHeight / 2
        if (backdrop) backdrop.style.background = `linear-gradient(#111 ${split}px, #fff ${split}px)`
      })
      await page.screenshot({ path: process.env.MARKTEXT_OUTLINE_SURFACE_SCREENSHOT || '../../../validation/outline-surface-20261018/solid-surface-proof.png' })
    } finally {
      await page.locator('#toc-background-probe').evaluate(node => node.remove())
    }
  })

  test('source mode keeps the same colors and label text without rewriting the note', async() => {
    await enterSourceMode(page, app)
    await expect(row('提问：').locator('.toc-label > span')).toHaveCSS('color', 'rgb(229, 57, 53)')
    await expect(row('状态切换').locator('.toc-label > span').last()).toHaveCSS('color', 'rgb(52, 152, 255)')
    expect(await getMarkdownContent(page, app)).toBe(markdown)
    await exitSourceMode(page, app)
    await expect(row('提问：').locator('.toc-label > span')).toHaveCSS('color', 'rgb(229, 57, 53)')
    await expectNoRendererErrors(app)
  })
})

test('light theme distinguishes six badges, matches heading colors and keeps the current overlay neutral', async() => {
  const markdown = '# 一级\n\n## 二级\n\n### 三级\n\n#### 四级\n\n##### 五级\n\n###### 六级\n\n' + '正文。\n\n'.repeat(100)
  const { app, page } = await launchWithMarkdown(markdown, {
    suppressErrorDialog: true,
    preferences: { floatingTocEnabled: true, floatingTocPinned: true, theme: 'light', followSystemTheme: false }
  })
  try {
    const toc = page.locator('.floating-toc')
    const headings = toc.locator('.toc-heading')
    await expect(headings).toHaveCount(6)
    const colors = await toc.locator('.toc-level').evaluateAll(elements => elements.map(element => getComputedStyle(element).color))
    expect(new Set(colors).size).toBe(6)
    expect(colors).toEqual(['rgb(20, 105, 181)', 'rgb(8, 123, 137)', 'rgb(79, 123, 72)', 'rgb(137, 101, 0)', 'rgb(169, 79, 18)', 'rgb(179, 46, 54)'])
    const headingColors = await headings.evaluateAll(elements => elements.map(element => getComputedStyle(element).color))
    const documentColors = await page.locator('.mu-container > h1, .mu-container > h2, .mu-container > h3, .mu-container > h4, .mu-container > h5, .mu-container > h6').evaluateAll(elements => elements.map(element => getComputedStyle(element).color))
    expect(headingColors).toEqual(documentColors)
    const row = toc.locator('li').filter({ has: page.locator('.toc-label', { hasText: '二级' }) })
    await row.locator('.toc-heading').click()
    await expect(row).toHaveClass(/active/)
    await expect(row.locator('.toc-heading')).toHaveCSS('color', headingColors[1])
    const overlay = await row.evaluate(element => {
      const probe = document.createElement('div')
      probe.style.backgroundImage = 'linear-gradient(var(--editorColor10), var(--editorColor10))'
      element.appendChild(probe)
      const expected = getComputedStyle(probe).backgroundImage
      probe.remove()
      return { actual: getComputedStyle(element).backgroundImage, expected }
    })
    expect(overlay.actual).toBe(overlay.expected)
    expect(await row.evaluate(element => getComputedStyle(element, '::before').content)).toBe('none')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('multicolor theme uses document heading colors for text, including the current row', async() => {
  const markdown = '# 一级\n\n## 二级\n\n### 三级\n\n#### 四级\n\n##### 五级\n\n###### 六级\n\n' + '正文。\n\n'.repeat(100)
  const { app, page } = await launchWithMarkdown(markdown, {
    suppressErrorDialog: true,
    preferences: { floatingTocEnabled: true, floatingTocPinned: true, theme: 'ayu-dark', followSystemTheme: false }
  })
  try {
    const toc = page.locator('.floating-toc')
    const headings = toc.locator('.toc-heading')
    await expect(headings).toHaveCount(6)
    const docColors = await page.locator('.mu-container > h1, .mu-container > h2, .mu-container > h3, .mu-container > h4, .mu-container > h5, .mu-container > h6').evaluateAll(elements => elements.map(element => getComputedStyle(element).color))
    expect(new Set(docColors).size).toBeGreaterThan(1)
    expect(await headings.evaluateAll(elements => elements.map(element => getComputedStyle(element).color))).toEqual(docColors)
    await headings.nth(1).click()
    await expect(headings.nth(1)).toHaveCSS('color', docColors[1])
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { enterSourceMode, exitSourceMode, expectNoRendererErrors, getMarkdownContent, launchWithMarkdown } from './helpers'

const headingSelector = '.mu-container > h1, .mu-container > h2, .mu-container > h3, .mu-container > h4, .mu-container > h5, .mu-container > h6'
const body = '这里是用于验证目录层级、滚动位置和配色的正文。'.repeat(16) + '\n\n'
const markdown = [
  '# 总章', '## 电路设计', '### 三极管驱动',
  '#### <span style="color:#e53935">控制端设计思路</span>',
  '##### 基极电流的选择', '###### 限流电阻计算', '#### 其他小节',
  '# 新的章节', '### 跨级父标题', '###### 跨级子标题', '# 结尾'
].map(title => `${title}\n\n${body}`).join('') + body.repeat(12)

const compact = async(page: Page) => {
  const toc = page.locator('.floating-toc')
  if ((await toc.getAttribute('class'))?.includes('pinned')) await toc.locator('[data-toc-action="pin"]').click()
  await page.mouse.move(40, 40)
  await expect(toc).not.toHaveClass(/expanded/)
}

const scrollTo = async(page: Page, title: string) => {
  await page.locator(headingSelector).filter({ hasText: title }).first().evaluate(heading => {
    const editor = heading.closest<HTMLElement>('.mu-editor')
    if (!editor) throw new Error('Editor is missing')
    editor.scrollTop += heading.getBoundingClientRect().top - editor.getBoundingClientRect().top
  })
  await expect(page.locator('.floating-toc li.active .toc-heading')).toHaveAttribute('aria-label', title)
}

test.describe('Floating directory ancestor colors', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(markdown, {
      suppressErrorDialog: true,
      preferences: { floatingTocEnabled: true, floatingTocPinned: false, theme: 'dark', followSystemTheme: false, language: 'zh-CN' }
    })
    app = launched.app
    page = launched.page
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900))
  })

  test.afterAll(async() => {
    if (!app) return
    try { await expectNoRendererErrors(app) } finally { await app.close() }
  })

  test('shows teal H5 and amber H4 for current H6 while more distant ancestors stay neutral', async() => {
    await compact(page)
    await scrollTo(page, '限流电阻计算')
    const toc = page.locator('.floating-toc')
    await expect(toc.locator('.parent-heading')).toHaveCount(1)
    await expect(toc.locator('.grandparent-heading')).toHaveCount(1)
    await expect(toc.locator('.parent-heading')).toHaveAttribute('data-toc-level', '5')
    await expect(toc.locator('.grandparent-heading')).toHaveAttribute('data-toc-level', '4')
    await expect(toc.locator('.parent-heading .toc-stroke')).toHaveCSS('background-color', 'rgb(101, 198, 163)')
    await expect(toc.locator('.grandparent-heading .toc-stroke')).toHaveCSS('background-color', 'rgb(232, 180, 90)')
    const colors = await toc.evaluate(nav => {
      const color = (selector: string) => {
        const stroke = nav.querySelector<HTMLElement>(selector)
        if (!stroke) throw new Error('Heading stroke is missing')
        return getComputedStyle(stroke).backgroundColor
      }
      const heading = nav.querySelector<HTMLElement>('.active .toc-heading')
      if (!heading) throw new Error('Active heading is missing')
      return {
        active: color('.active .toc-stroke'),
        heading: getComputedStyle(heading).color,
        distant: color('li[data-toc-level="1"] .toc-stroke'),
        other: color('li:last-child .toc-stroke')
      }
    })
    expect(colors.active).toBe(colors.heading)
    expect(colors.distant).toBe(colors.other)
    await page.screenshot({ path: '../../validation/floating-toc-v8.37/compact-h6.png' })

    await scrollTo(page, '基极电流的选择')
    await expect(toc.locator('.parent-heading')).toHaveAttribute('data-toc-level', '4')
    await expect(toc.locator('.grandparent-heading')).toHaveAttribute('data-toc-level', '3')
    await scrollTo(page, '总章')
    await expect(toc.locator('.parent-heading')).toHaveCount(0)
    await expect(toc.locator('.grandparent-heading')).toHaveCount(0)
  })

  test('uses level colors rather than ancestor colors on expanded badges and keeps source HTML colors', async() => {
    await compact(page)
    await scrollTo(page, '限流电阻计算')
    const toc = page.locator('.floating-toc')
    const before = await toc.locator('.toc-list').evaluate(list => list.scrollTop)
    await toc.hover()
    const badgeColors = await toc.locator('.toc-level').evaluateAll(elements => elements.map(element => getComputedStyle(element).color))
    expect(new Set(badgeColors).size).toBe(6)
    await expect(toc.locator('.grandparent-heading .toc-label > span')).toHaveCSS('color', 'rgb(229, 57, 53)')
    await page.screenshot({ path: '../../validation/floating-toc-v8.38/expanded-h6.png' })
    await page.mouse.move(40, 40)
    await expect(toc).not.toHaveClass(/expanded/)
    expect(await toc.locator('.toc-list').evaluate(list => list.scrollTop)).toBe(before)
    expect(await getMarkdownContent(page, app)).toBe(markdown)
  })

  test('follows the real two ancestors across skipped heading levels and source mode', async() => {
    await compact(page)
    await scrollTo(page, '跨级子标题')
    const toc = page.locator('.floating-toc')
    await expect(toc.locator('.parent-heading')).toHaveAttribute('data-toc-level', '3')
    await expect(toc.locator('.grandparent-heading')).toHaveAttribute('data-toc-level', '1')
    await enterSourceMode(page, app)
    await page.locator('.source-code').evaluate(container => {
      const line = [...container.querySelectorAll<HTMLElement>('.CodeMirror-line')].find(line => line.textContent?.includes('###### 跨级子标题'))
      if (!line) throw new Error('Source heading is missing')
      container.scrollTop += line.getBoundingClientRect().top - container.getBoundingClientRect().top
    })
    await expect(toc.locator('li.active .toc-heading')).toHaveAttribute('aria-label', '跨级子标题')
    await expect(toc.locator('.parent-heading .toc-stroke')).toHaveCSS('background-color', 'rgb(101, 198, 163)')
    await expect(toc.locator('.grandparent-heading .toc-stroke')).toHaveCSS('background-color', 'rgb(232, 180, 90)')
    await exitSourceMode(page, app)
    await scrollTo(page, '限流电阻计算')
    await expect(toc.locator('.parent-heading')).toHaveAttribute('data-toc-level', '5')
    await expect(toc.locator('.grandparent-heading')).toHaveAttribute('data-toc-level', '4')
  })
})

test('light themes keep the two ancestor hues visible with darker shades', async() => {
  const { app, page } = await launchWithMarkdown(markdown, {
    suppressErrorDialog: true,
    preferences: { floatingTocEnabled: true, floatingTocPinned: false, theme: 'light', followSystemTheme: false }
  })
  try {
    await compact(page)
    await scrollTo(page, '限流电阻计算')
    await expect(page.locator('body')).not.toHaveClass(/dark/)
    await expect(page.locator('.toc-rail .parent-heading .toc-stroke')).toHaveCSS('background-color', 'rgb(35, 124, 96)')
    await expect(page.locator('.toc-rail .grandparent-heading .toc-stroke')).toHaveCSS('background-color', 'rgb(148, 98, 0)')
    await expectNoRendererErrors(app)
  } finally { await app.close() }
})

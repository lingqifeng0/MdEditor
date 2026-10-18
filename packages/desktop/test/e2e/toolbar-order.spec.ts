import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { TOOLBAR_BUTTONS } from '../../src/common/toolbar'
import { expectNoRendererErrors, launchWithMarkdown } from './helpers'

test.describe('Custom formatting toolbar order', () => {
  test.describe.configure({ mode: 'serial' })
  let app: ElectronApplication
  let page: Page
  let settings: Page
  const screenshotDirectory = process.env.MARKTEXT_TOOLBAR_SCREENSHOTS
  const currentOrder = () => page.locator('.mu-inline-tools > [data-toolbar-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-toolbar-id')))
  const settingsOrder = () => settings.locator('[data-toolbar-button]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-toolbar-button')))
  const selectText = async(expected = 'Toolbar sample text.') => {
    await page.locator('.mu-paragraph-content').first().click()
    await page.keyboard.press('Control+A')
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim())).toBe(expected)
  }

  const openPreferences = async() => {
    const opened = app.waitForEvent('window')
    await app.evaluate(({ ipcMain }) => { ipcMain.emit('app-create-settings-window') })
    settings = await opened
    await settings.waitForSelector('.pref-container')
    await settings.evaluate(() => { location.hash = '#/preference/editor' })
    await expect(settings.getByTestId('toolbar-order-settings')).toBeVisible()
  }

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('Toolbar sample text.\n', {
      suppressErrorDialog: true,
      preferences: { language: 'zh-CN', theme: 'dark', followSystemTheme: false }
    })
    app = launched.app
    page = launched.page
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 850))
  })

  test.afterAll(async() => {
    if (!app) return
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy() })
    await app.close()
  })

  test('default toolbar stays complete and uses distinct highlighter and T× glyphs', async() => {
    await selectText()
    await expect.poll(currentOrder).toEqual(TOOLBAR_BUTTONS)
    await expect(page.locator('.mu-inline-tools .mark svg path')).toHaveCount(3)
    await expect(page.locator('.mu-inline-tools .clear svg path')).toHaveCount(5)
    await expect(page.locator('.mu-inline-tools .mark svg path').last()).toHaveAttribute('stroke', '#fff18c')
  })

  test('single-row icon slots swap only two buttons, survive reload, and keep the note clean', async() => {
    await openPreferences()
    await expect.poll(settingsOrder).toEqual(TOOLBAR_BUTTONS)
    const clear = settings.locator('[data-toolbar-button="clear"]')
    const expected = [...TOOLBAR_BUTTONS]
    ;[expected[0], expected[12]] = [expected[12], expected[0]]
    await clear.dragTo(settings.locator('[data-toolbar-button="codeblock"]'))
    await expect.poll(settingsOrder).toEqual(expected)
    const layout = await settings.locator('.toolbar-slot').evaluateAll(nodes => nodes.map(node => ({ top: node.getBoundingClientRect().top, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, named: Boolean(node.getAttribute('title')), icon: Boolean(node.querySelector('svg path, .asset-icon, .heading-icon')) })))
    expect(new Set(layout.map(item => item.top)).size).toBe(1)
    expect(layout.every(item => item.width <= 40 && item.height <= 42 && item.named && item.icon)).toBe(true)
    const assetMasks = await settings.locator('.asset-icon').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).maskImage))
    expect(assetMasks).toHaveLength(5)
    expect(assetMasks.every(mask => mask.startsWith('url('))).toBe(true)
    await expect(settings.locator('.move-button, .drag-handle')).toHaveCount(0)
    await settings.reload()
    await expect.poll(settingsOrder).toEqual(expected)
    if (screenshotDirectory) await settings.screenshot({ path: `${screenshotDirectory}/toolbar-order-settings.png` })
    await settings.close()
    await selectText()
    await expect.poll(currentOrder).toEqual(expected)
    if (screenshotDirectory) await page.screenshot({ path: `${screenshotDirectory}/custom-toolbar.png` })
    expect(await page.evaluate(() => {
      const app = document.querySelector('#app') as HTMLElement & { __vue_app__: { config: { globalProperties: { $pinia: { _s: Map<string, { currentFile: { isSaved: boolean } }> } } } } }
      return app.__vue_app__.config.globalProperties.$pinia._s.get('editor')?.currentFile.isSaved
    })).toBe(true)
  })

  test('moved formatting buttons still target the selected text and color controls stay grouped', async() => {
    await selectText()
    await page.locator('.mu-inline-tools .strong').click()
    await expect(page.locator('.mu-editor strong')).toContainText('Toolbar sample text.')
    await selectText('**Toolbar sample text.**')
    await page.locator('.mu-inline-tools .clear').click()
    await expect(page.locator('.mu-editor strong')).toHaveCount(0)
    await expect(page.locator('.mu-paragraph-content').first()).toHaveText('Toolbar sample text.')
    await selectText()
    await expect(page.locator('.mu-inline-tools .text-color button')).toHaveCount(2)
    await expect(page.locator('.mu-inline-tools .background-color button')).toHaveCount(2)
    await page.getByRole('button', { name: '选择背景颜色', exact: true }).click()
    await expect(page.locator('.mu-color-palette')).toBeVisible()
    await page.getByRole('button', { name: '选择背景颜色', exact: true }).click()
    await expect(page.locator('.mu-color-palette')).toHaveCount(0)
  })

  test('canceling a drag preserves order and restoring defaults persists across reload', async() => {
    await openPreferences()
    await expect.poll(async() => (await settingsOrder())[0]).toBe('clear')
    const before = await settingsOrder()
    const clear = settings.locator('[data-toolbar-button="clear"]')
    const dataTransfer = await settings.evaluateHandle(() => new DataTransfer())
    await clear.dispatchEvent('dragstart', { dataTransfer })
    await settings.locator('[data-toolbar-button="mark"]').dispatchEvent('dragover', { dataTransfer })
    await expect(settings.locator('[data-toolbar-button="mark"]')).toHaveClass(/swap-target/)
    if (screenshotDirectory) await settings.screenshot({ path: `${screenshotDirectory}/toolbar-swap-highlight.png` })
    await settings.keyboard.press('Escape')
    await clear.dispatchEvent('dragend', { dataTransfer })
    await expect(settings.locator('.swap-target')).toHaveCount(0)
    expect(await settingsOrder()).toEqual(before)
    const strip = settings.locator('.order-strip')
    await strip.evaluate(element => { element.scrollLeft = 0 })
    const stripBox = await strip.boundingBox()
    if (!stripBox) throw new Error('Toolbar slot strip is not visible')
    await clear.dispatchEvent('dragstart', { dataTransfer })
    await strip.dispatchEvent('dragover', { dataTransfer, clientX: stripBox.x + stripBox.width - 4 })
    await expect.poll(() => strip.evaluate(element => element.scrollLeft)).toBeGreaterThan(30)
    await clear.dispatchEvent('dragend', { dataTransfer })
    expect(await settingsOrder()).toEqual(before)
    await dataTransfer.dispose()
    await settings.locator('.order-strip').evaluate(element => { element.scrollLeft = element.scrollWidth })
    await settings.locator('[data-toolbar-button="background-color"]').dragTo(settings.locator('[data-toolbar-button="text-color"]'))
    await expect.poll(async() => (await settingsOrder()).slice(-2)).toEqual(['background-color', 'text-color'])
    await settings.getByRole('button', { name: '恢复默认顺序', exact: true }).click()
    await expect.poll(settingsOrder).toEqual(TOOLBAR_BUTTONS)
    await expect(settings.getByRole('button', { name: '恢复默认顺序', exact: true })).toBeDisabled()
    await settings.reload()
    await expect.poll(settingsOrder).toEqual(TOOLBAR_BUTTONS)
    if (screenshotDirectory) {
      await settings.screenshot({ path: `${screenshotDirectory}/toolbar-default-slots.png` })
      await settings.getByTestId('toolbar-order-settings').screenshot({ path: `${screenshotDirectory}/toolbar-slots-strip.png` })
    }
    await settings.close()
    await selectText()
    await expect.poll(currentOrder).toEqual(TOOLBAR_BUTTONS)
    await expectNoRendererErrors(app)
  })
})

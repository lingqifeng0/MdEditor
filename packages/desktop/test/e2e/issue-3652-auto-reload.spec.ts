import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { launchWithMarkdown, typeIntoEditor } from './helpers'

// #3652 — MarkText open beside another editor. A tab the user never edited
// discards nothing when it reloads, so it reloads silently; a tab holding
// unsaved edits must still ask before those edits are thrown away.
//
// Both cases drive the REAL watcher by writing the file on disk.

const isDirty = (page: Page) =>
  page.evaluate(() => !!document.querySelector('.editor-tabs li.unsaved'))

const editorText = (page: Page) =>
  page.evaluate(() => document.querySelector('.editor-component')?.textContent ?? '')

const reloadBannerText = (page: Page) =>
  page.evaluate(
    () => document.querySelector('.editor-notifications .msg')?.textContent ?? ''
  )

test.describe('Issue #3652 — reloading a file changed on disk', () => {
  test('a tab with no local edits reloads without asking', async() => {
    const { app, page, filePath } = await launchWithMarkdown('from marktext\n')
    await page.waitForTimeout(500)

    fs.writeFileSync(filePath, 'from another editor\n', 'utf-8')
    await expect.poll(() => editorText(page), { timeout: 8000 }).toContain(
      'from another editor'
    )

    expect(await isDirty(page)).toBe(false)
    expect(await reloadBannerText(page)).toBe('')

    await app.close()
  })

  test('separates confirming and dismissing the reload prompt for unsaved edits', async() => {
    const { app, page, filePath } = await launchWithMarkdown('from marktext\n', {
      preferences: { language: 'zh-CN' }
    })
    try {
      await app.evaluate(({ BrowserWindow }) => {
        const editor = BrowserWindow.getAllWindows()[0]
        editor.unmaximize()
        editor.setContentSize(1100, 700)
      })
      await typeIntoEditor(page, ' edited here')
      await expect.poll(() => isDirty(page)).toBe(true)

      fs.writeFileSync(filePath, 'from another editor\n', 'utf-8')
      const banner = page.locator('.editor-notifications')
      const message = banner.getByRole('status')
      const confirm = banner.getByRole('button', { name: '确定' })
      const dismiss = banner.getByRole('button', { name: '关闭' })
      await expect(message).toHaveText(
        `「${path.basename(filePath)}」已在别处更新。用新版替换未保存的内容吗？`,
        { timeout: 8000 }
      )

      const confirmBox = await confirm.boundingBox()
      const dismissBox = await dismiss.boundingBox()
      const messageBox = await message.boundingBox()
      if (!confirmBox || !dismissBox || !messageBox) throw new Error('The reload prompt is not fully visible')
      expect(confirmBox.x - messageBox.x - messageBox.width).toBeLessThan(18)
      expect(dismissBox.x - confirmBox.x - confirmBox.width).toBeGreaterThan(180)
      expect(await editorText(page)).toContain('edited here')

      await dismiss.click()
      await expect(banner).toHaveCount(0)
      expect(await isDirty(page)).toBe(true)
      expect(await editorText(page)).toContain('edited here')

      await app.evaluate(({ BrowserWindow }) => {
        const editor = BrowserWindow.getAllWindows()[0]
        editor.setMinimumSize(380, 450)
        editor.setContentSize(400, 600)
      })
      fs.writeFileSync(filePath, 'a newer version on disk\n', 'utf-8')
      await expect(banner).toBeVisible({ timeout: 8000 })
      await expect.poll(async() => {
        const confirmBox = await confirm.boundingBox()
        const dismissBox = await dismiss.boundingBox()
        return confirmBox && dismissBox ? confirmBox.y - dismissBox.y : 0
      }).toBeGreaterThan(16)
      await confirm.click()
      await expect.poll(() => editorText(page)).toContain('a newer version on disk')
      await expect(banner).toHaveCount(0)
    } finally {
      await app.close()
    }
  })
})

import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from 'playwright'
import type { Editor as CodeMirrorEditor } from 'codemirror'
import {
  closeElectronWithoutSaving,
  enterSourceMode,
  expectNoRendererErrors,
  launchWithMarkdown,
  placeCaretInEditor
} from './helpers'

const editorSelector = '.editor-component.mu-editor'
const tabsSelector = '.tabs-container > li'
const options = {
  suppressErrorDialog: true,
  preferences: { language: 'zh-CN', tabBarVisibility: true, openFilesInNewWindow: false }
}

const clickMoveFromNativeMenu = (app: ElectronApplication): Promise<void> =>
  app.evaluate(({ ipcMain }) => {
    // Exercise the renderer's real context-menu callback without leaving a
    // native Windows menu open in the automation session.
    ipcMain.removeAllListeners('mt::menu::popup')
    ipcMain.on('mt::menu::popup', (event, template: Array<{ id?: string; label?: string; enabled?: boolean }>) => {
      const move = template.find(item => item.id?.startsWith('moveTabToNewWindow-'))
      if (move?.id && move.label === '移到新窗口' && move.enabled !== false) {
        event.sender.send('mt::menu::click', { id: move.id })
      }
    })
  })

const openSecondNote = async(app: ElectronApplication, page: Page, filePath: string) => {
  const window = await app.browserWindow(page)
  const id = await window.evaluate(win => win.id)
  await app.evaluate(({ ipcMain }, { id, filePath }) => {
    ipcMain.emit('app-open-file-by-id', id, filePath)
  }, { id, filePath })
}

test('moves the selected note into an independent window with its edits, scroll position and undo history', async() => {
  const { app, page, filePath } = await launchWithMarkdown('# Student view\n\nShow this note on the second screen.\n', options)
  try {
    const notesPath = path.join(path.dirname(filePath), 'teacher-notes.md')
    const original = '# Speaker notes\n\nThis is a note for the teacher.\n\n' +
      Array.from({ length: 70 }, (_, index) => `Paragraph ${index + 1}.\n\n`).join('')
    fs.writeFileSync(notesPath, original, 'utf8')
    await openSecondNote(app, page, notesPath)
    const originalTeacherTab = page.locator(tabsSelector).filter({ hasText: 'teacher-notes.md' })
    const sourceEditor = page.locator(editorSelector)
    await expect(originalTeacherTab).toHaveClass(/active/)
    await expect(sourceEditor).toContainText('This is a note for the teacher.')
    await placeCaretInEditor(page)
    await page.keyboard.insertText(' unsaved words')
    await expect(originalTeacherTab).toHaveClass(/unsaved/)
    const editedParagraph = await sourceEditor.locator('.mu-paragraph-content').first().textContent()
    if (!editedParagraph?.includes('unsaved words')) throw new Error('The fixture edit did not reach the original tab')
    await sourceEditor.evaluate(node => {
      node.scrollTop = 940
      node.dispatchEvent(new Event('scroll'))
    })
    await expect.poll(() => sourceEditor.evaluate(node => node.scrollTop)).toBe(940)
    await page.locator(tabsSelector).filter({ hasText: path.basename(filePath) }).click()
    await expect(sourceEditor).toContainText('Show this note on the second screen.')
    await clickMoveFromNativeMenu(app)

    const created = app.waitForEvent('window')
    await originalTeacherTab.click({ button: 'right' })
    const detached = await created
    const detachedEditor = detached.locator(editorSelector)
    const detachedTab = detached.locator(tabsSelector).filter({ hasText: 'teacher-notes.md' })
    await expect(originalTeacherTab).toHaveCount(0)
    await expect(page.locator(tabsSelector)).toHaveCount(1)
    await expect(sourceEditor).toContainText('Show this note on the second screen.')
    await expect(detachedTab).toHaveClass(/unsaved/)
    await expect(detachedEditor).toContainText(editedParagraph)
    await expect.poll(() => detachedEditor.evaluate(node => node.scrollTop)).toBeGreaterThan(850)
    expect(fs.readFileSync(notesPath, 'utf8')).toBe(original)

    const newWindow = await app.browserWindow(detached)
    const sourceWindow = await app.browserWindow(page)
    expect(await newWindow.evaluate(win => win.id)).not.toBe(await sourceWindow.evaluate(win => win.id))
    expect(await newWindow.evaluate(win => win.isVisible() && win.getParentWindow() === null)).toBe(true)

    await newWindow.evaluate(win => win.webContents.send('mt::editor-edit-action', 'undo'))
    await expect(detachedEditor).not.toContainText('unsaved words')
    await expect(detachedTab).not.toHaveClass(/unsaved/)
    await expectNoRendererErrors(app)
    await newWindow.evaluate(win => win.webContents.send('mt::editor-edit-action', 'redo'))
    await expect(detachedTab).toHaveClass(/unsaved/)
    await newWindow.evaluate(win => win.webContents.send('mt::editor-ask-file-save'))
    await expect.poll(() => fs.readFileSync(notesPath, 'utf8')).toContain('unsaved words')
    await expect(detachedTab).not.toHaveClass(/unsaved/)
  } finally {
    await closeElectronWithoutSaving(app)
  }
})

test('keeps an unsaved tab in the source window when the new window fails', async() => {
  const { app, page, filePath } = await launchWithMarkdown('# Original\n\nMy note.\n', options)
  try {
    await placeCaretInEditor(page)
    await page.keyboard.type(' Keep this edit.')
    const tab = page.locator(tabsSelector).filter({ hasText: path.basename(filePath) })
    await expect(tab).toHaveClass(/unsaved/)
    await clickMoveFromNativeMenu(app)
    await app.evaluate(({ app }) => {
      app.once('browser-window-created', (_event, window) => {
        setImmediate(() => window.destroy())
      })
    })
    await tab.click({ button: 'right' })
    await expect(page.getByText('无法打开新窗口，笔记仍在原窗口。')).toBeVisible()
    await expect(tab).toHaveClass(/unsaved/)
    await expect(page.locator(editorSelector)).toContainText('Keep this edit.')
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    expect(fs.readFileSync(filePath, 'utf8')).not.toContain('Keep this edit.')
    await expectNoRendererErrors(app)
  } finally {
    await closeElectronWithoutSaving(app)
  }
})

test('retains source editing mode and CodeMirror undo in the new window', async() => {
  const { app, page, filePath } = await launchWithMarkdown('# Source text\n\nOriginal source.\n', options)
  try {
    await enterSourceMode(page, app)
    await page.locator('.source-code .CodeMirror').evaluate(node => {
      const cm = (node as HTMLElement & { CodeMirror?: CodeMirrorEditor }).CodeMirror
      if (!cm) throw new Error('Source editor missing')
      cm.replaceRange(' Before move.', { line: 2, ch: 16 }, undefined, '+input')
      cm.setCursor({ line: 2, ch: 25 })
    })
    const tab = page.locator(tabsSelector).filter({ hasText: path.basename(filePath) })
    await expect(tab).toHaveClass(/unsaved/)
    await clickMoveFromNativeMenu(app)
    const created = app.waitForEvent('window')
    await tab.click({ button: 'right' })
    const detached = await created
    const source = detached.locator('.source-code .CodeMirror')
    await expect(tab).toHaveCount(0)
    await expect(source).toContainText('Original source. Before move.')
    const window = await app.browserWindow(detached)
    await window.evaluate(win => win.webContents.send('mt::editor-edit-action', 'undo'))
    await expect(source).not.toContainText('Before move.')
    await expectNoRendererErrors(app)
  } finally {
    await closeElectronWithoutSaving(app)
  }
})

test('keeps edits entered while the new window is loading', async() => {
  const { app, page, filePath } = await launchWithMarkdown('# Draft\n\nEditing during the move.\n', options)
  try {
    await clickMoveFromNativeMenu(app)
    await app.evaluate(({ ipcMain }) => {
      const readyListeners = ipcMain.listeners('mt::window-initialized')
      ipcMain.removeAllListeners('mt::window-initialized')
      ipcMain.on('mt::window-initialized', (event, tabId?: string) => {
        ipcMain.once('test::finish-loading-tab-window', () => {
          for (const ready of readyListeners) ready(event, tabId)
        })
      })
    })
    const tab = page.locator(tabsSelector).filter({ hasText: path.basename(filePath) })
    await tab.click({ button: 'right' })
    await expect.poll(() => app.evaluate(({ ipcMain }) =>
      ipcMain.listenerCount('test::finish-loading-tab-window')
    )).toBe(1)
    await placeCaretInEditor(page)
    await page.keyboard.insertText(' New edit.')
    await expect(tab).toHaveClass(/unsaved/)
    await app.evaluate(({ ipcMain }) => { ipcMain.emit('test::finish-loading-tab-window') })
    await expect(page.getByText('打开新窗口时笔记有了改动，请再移动一次。')).toBeVisible()
    await expect(tab).toHaveClass(/unsaved/)
    await expect(page.locator(editorSelector)).toContainText('New edit.')
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    await expectNoRendererErrors(app)
  } finally {
    await closeElectronWithoutSaving(app)
  }
})

test('moves an unanswered file reload prompt with the tab', async() => {
  const { app, page, filePath } = await launchWithMarkdown('# Reload conflict\n\nOriginal text.\n', options)
  try {
    await placeCaretInEditor(page)
    await page.keyboard.insertText(' unsaved edit')
    const tab = page.locator(tabsSelector).filter({ hasText: path.basename(filePath) })
    await expect(tab).toHaveClass(/unsaved/)
    fs.writeFileSync(filePath, '# Reload conflict\n\nUpdated outside the editor.\n', 'utf8')
    await expect(page.locator('.editor-notifications')).toBeVisible()
    await clickMoveFromNativeMenu(app)
    const created = app.waitForEvent('window')
    await tab.click({ button: 'right' })
    const detached = await created
    await expect(tab).toHaveCount(0)
    await expect(detached.locator(editorSelector)).toContainText('unsaved edit')
    await detached.locator('.editor-notifications').getByRole('button', { name: '确定' }).click()
    await expect(detached.locator(editorSelector)).toContainText('Updated outside the editor.')
    await expect(detached.locator(tabsSelector).first()).not.toHaveClass(/unsaved/)
    await expectNoRendererErrors(app)
  } finally {
    await closeElectronWithoutSaving(app)
  }
})

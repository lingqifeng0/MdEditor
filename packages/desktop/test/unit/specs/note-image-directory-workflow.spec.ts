import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
const mocks = vi.hoisted(() => ({ store: { currentFile: null as Record<string, unknown> | null, flushActiveEditor: vi.fn(), APPLY_FILE_PATH: vi.fn() }, prepare: vi.fn(), save: vi.fn() }))
vi.mock('@/store/editor', () => ({ useEditorStore: () => mocks.store }))
import { prepareImageDirectory } from '@/util/noteImageDirectoryWorkflow'
import { confirmImageOperation, finishImageOperation, imageOperationPrompt } from '@/util/imageOperationDialog'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.store.currentFile = reactive({ id: 'folder-note', filename: '项目.md', pathname: 'C:/项目.md', markdown: '# 原笔记', encoding: { encoding: 'utf8', isBom: false }, lineEnding: 'lf', adjustLineEndingOnSave: false, trimTrailingNewline: 3 })
  mocks.prepare.mockImplementation(async(request) => { structuredClone(request); return { ok: true, pathname: 'C:/项目/项目.md', directory: 'C:/项目/assets' } })
  mocks.save.mockResolvedValue('C:/项目.md')
  Object.assign(window, { path: path.win32, electron: { images: { prepareDirectory: mocks.prepare }, dialog: { showSave: mocks.save } } })
})
afterEach(() => finishImageOperation(false))
describe('directory workflow across the Electron boundary', () => {
  it('sends cloneable save options even when the active note has a reactive encoding object', async() => {
    const pending = prepareImageDirectory({ ok: false, errorCode: 'wrongParent', stem: '项目' }, 'folder-note')
    expect(await prepareImageDirectory({ ok: false, errorCode: 'wrongParent', stem: '项目' }, 'folder-note')).toBeNull()
    await confirmImageOperation()
    expect(await pending).toMatchObject({ pathname: 'C:/项目/项目.md' })
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
    expect(mocks.store.APPLY_FILE_PATH).toHaveBeenCalledWith(expect.objectContaining({ preserveSavedState: true, pathname: 'C:/项目/项目.md' }))
    expect(imageOperationPrompt.value).toBeNull()
  })
  it('keeps the same prompt after a save picker cancellation, then allows saving', async() => {
    if (mocks.store.currentFile) mocks.store.currentFile.pathname = ''
    mocks.save.mockResolvedValueOnce(null)
    const pending = prepareImageDirectory({ ok: false, errorCode: 'unsaved' }, 'folder-note')
    await confirmImageOperation()
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(imageOperationPrompt.value).not.toBeNull()
    await confirmImageOperation()
    expect(await pending).toMatchObject({ pathname: 'C:/项目/项目.md' })
    expect(mocks.store.APPLY_FILE_PATH).toHaveBeenCalledWith(expect.objectContaining({ preserveSavedState: false }))
  })
  it('does not prepare files after the selected note has changed', async() => {
    const pending = prepareImageDirectory({ ok: false, errorCode: 'missingDirectory', stem: '项目' }, 'folder-note')
    if (mocks.store.currentFile) mocks.store.currentFile.id = 'another-note'
    await confirmImageOperation()
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(imageOperationPrompt.value?.error).toContain('已切换')
    finishImageOperation(false)
    expect(await pending).toBeNull()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  note: { id: 'delete-note', pathname: 'C:/notes/项目/项目.md', markdown: '![](assets/photo.png)' },
  trash: vi.fn(),
  restore: vi.fn(),
  flush: vi.fn()
}))
vi.mock('@/store/editor', () => ({ useEditorStore: () => ({ currentFile: mocks.note, tabs: [mocks.note], flushActiveEditor: mocks.flush }) }))
import { deleteNoteImages, imageReferenceCount, synchronizeDeletedImages } from '@/util/noteImageDeletion'
import { confirmImageOperation, finishImageOperation, imageOperationPrompt } from '@/util/imageOperationDialog'
let noteNumber = 0

beforeEach(() => {
  vi.clearAllMocks()
  mocks.note.id = `delete-note-${++noteNumber}`
  mocks.note.markdown = '![](assets/photo.png)'
  mocks.trash.mockResolvedValue({ ok: true })
  mocks.restore.mockResolvedValue({ ok: true })
  Object.assign(window, { electron: { process: { platform: 'win32' }, images: { trash: mocks.trash, restoreTrash: mocks.restore } } })
})
afterEach(() => finishImageOperation(false))
describe('image deletion ownership and history', () => {
  it('counts real image references, including duplicate Markdown and HTML, and skips code examples', () => {
    const markdown = '![](assets/photo.png)\n\n![](assets/photo.png)\n\n<div><img src="assets/photo.png"></div>\n\n`![](assets/photo.png)`\n\n```\n![](assets/photo.png)\n```'
    expect(imageReferenceCount(markdown, 'assets/photo.png')).toBe(3)
  })
  it('keyboard cancellation preserves the link and does not remove a file', async() => {
    const commit = vi.fn(() => true)
    const pending = deleteNoteImages(['assets/photo.png'], commit, () => true, 'keyboard')
    expect(imageOperationPrompt.value?.title).toBe('删除图片')
    expect(await deleteNoteImages(['assets/photo.png'], commit, () => true, 'keyboard')).toBe(false)
    expect(mocks.trash).not.toHaveBeenCalled()
    finishImageOperation(false)
    expect(await pending).toBe(false)
    expect(commit).not.toHaveBeenCalled()
  })
  it('toolbar deletion asks before trashing and commits after confirmation', async() => {
    const commit = vi.fn(() => { mocks.note.markdown = ''; return true })
    const pending = deleteNoteImages(['assets/photo.png'], commit, () => true)
    expect(imageOperationPrompt.value?.secondaryLabel).toBe('只删除链接')
    expect(mocks.trash).not.toHaveBeenCalled()
    await confirmImageOperation()
    expect(await pending).toBe(true)
    expect(mocks.trash).toHaveBeenCalledWith('assets/photo.png', mocks.note.pathname)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(imageOperationPrompt.value).toBeNull()
  })
  it('only-links removes Markdown without touching the local file', async() => {
    const commit = vi.fn(() => { mocks.note.markdown = ''; return true })
    const pending = deleteNoteImages(['assets/photo.png'], commit, () => true)
    finishImageOperation('links')
    expect(await pending).toBe(true)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(mocks.trash).not.toHaveBeenCalled()
  })
  it('restores the file when a stale Markdown target rejects the async commit', async() => {
    mocks.trash.mockResolvedValue({ ok: true, token: 'stale-token' })
    const commit = vi.fn(() => false)
    expect(await deleteNoteImages(['assets/photo.png'], commit, () => true, 'confirmed')).toBe(false)
    expect(mocks.restore).toHaveBeenCalledWith('stale-token', true)
  })
  it('restores bytes on undo and removes them again on redo, even with another reference remaining', async() => {
    mocks.note.markdown = '![](assets/shared.png)\n\n![](assets/shared.png)'
    mocks.trash.mockResolvedValue({ ok: true, token: 'history-token' })
    expect(await deleteNoteImages(['assets/shared.png'], () => { mocks.note.markdown = '![](assets/shared.png)'; return true }, () => true, 'confirmed')).toBe(true)
    await synchronizeDeletedImages()
    expect(mocks.restore).not.toHaveBeenCalledWith('history-token', true)
    mocks.note.markdown = '![](assets/shared.png)\n\n![](assets/shared.png)'
    await synchronizeDeletedImages()
    expect(mocks.restore).toHaveBeenCalledWith('history-token', true)
    mocks.note.markdown = '![](assets/shared.png)'
    await synchronizeDeletedImages()
    expect(mocks.restore).toHaveBeenCalledWith('history-token', false)
  })
  it('an only-links edit after undo does not replay a discarded physical-delete redo branch', async() => {
    mocks.trash.mockResolvedValue({ ok: true, token: 'old-branch-token' })
    await deleteNoteImages(['assets/photo.png'], () => { mocks.note.markdown = ''; return true }, () => true, 'confirmed')
    mocks.note.markdown = '![](assets/photo.png)'
    await synchronizeDeletedImages()
    expect(mocks.restore).toHaveBeenCalledWith('old-branch-token', true)
    mocks.restore.mockClear()
    const pending = deleteNoteImages(['assets/photo.png'], () => { mocks.note.markdown = ''; return true }, () => true)
    finishImageOperation('links')
    expect(await pending).toBe(true)
    await synchronizeDeletedImages()
    expect(mocks.restore).not.toHaveBeenCalled()
    mocks.note.markdown = '![](assets/photo.png)'
    await synchronizeDeletedImages()
    mocks.note.markdown = ''
    await synchronizeDeletedImages()
    expect(mocks.restore).not.toHaveBeenCalled()
  })
  it('only-links changes staged in an HTML draft also retire restored file-delete records on apply', async() => {
    mocks.trash.mockResolvedValue({ ok: true, token: 'html-old-branch-token' })
    await deleteNoteImages(['assets/photo.png'], () => { mocks.note.markdown = ''; return true }, () => true, 'confirmed')
    mocks.note.markdown = '![](assets/photo.png)'
    await synchronizeDeletedImages()
    mocks.restore.mockClear()
    expect(await deleteNoteImages([], () => { mocks.note.markdown = ''; return true }, () => true, 'confirmed', 'image', ['assets/photo.png'])).toBe(true)
    await synchronizeDeletedImages()
    expect(mocks.restore).not.toHaveBeenCalled()
  })
})

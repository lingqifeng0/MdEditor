import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readFileSync, loadMarkdownFile, send, logError } = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  loadMarkdownFile: vi.fn(),
  send: vi.fn(),
  logError: vi.fn()
}))

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), dialog: {}, ipcMain: { emit: vi.fn() } }))
vi.mock('electron-log', () => ({ default: { error: logError } }))
vi.mock('electron-window-state', () => ({ default: vi.fn() }))
vi.mock('fs', () => ({ default: { readFileSync } }))
vi.mock('main_renderer/config', () => ({
  TITLE_BAR_HEIGHT: 28, editorWinOptions: {}, isLinux: false, isOsx: false
}))
vi.mock('main_renderer/windows/utils', () => ({ ensureWindowPosition: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn() }))
vi.mock('main_renderer/contextMenu/editor', () => ({ showEditorContextMenu: vi.fn() }))
vi.mock('main_renderer/filesystem/markdown', () => ({ loadMarkdownFile }))
vi.mock('main_renderer/spellchecker', () => ({ switchLanguage: vi.fn() }))

const { default: EditorWindow } = await import('main_renderer/windows/editor')
const { WindowLifecycle } = await import('main_renderer/windows/base')
const restoreAllState = (
  EditorWindow.prototype as unknown as { _restoreAllState: () => void }
)._restoreAllState

const savedTab = () => ({
  id: 'retained-tab-id',
  filename: 'course.md',
  pathname: '/notes/course.md',
  markdown: 'cached edited content',
  isSaved: true,
  encoding: { encoding: 'utf16-le', isBom: false },
  lineEnding: 'lf',
  adjustLineEndingOnSave: false,
  trimTrailingNewline: 3,
  isMixedLineEndings: false,
  history: { stack: [{ id: 41, content: 'retained history' }], lastEditIndex: 0 },
  cursor: { key: 'retained-caret' }
})
const diskDocument = () => ({
  pathname: '/notes/course.md',
  filename: 'course.md',
  markdown: 'actual saved disk content\n',
  encoding: { encoding: 'utf8', isBom: true },
  lineEnding: 'crlf',
  adjustLineEndingOnSave: true,
  trimTrailingNewline: 1,
  isMixedLineEndings: true
})
const harness = () => ({
  lifecycle: WindowLifecycle.READY,
  browserWindow: { webContents: { send } },
  bufferStoreInfo: { id: 'recovery-id', filePath: '/cache/recovery.json' },
  _openedFiles: [] as string[],
  _accessor: {
    menu: { addRecentlyUsedDocument: vi.fn() },
    preferences: {
      getPreferredEol: () => 'lf',
      getAll: () => ({ autoGuessEncoding: true, trimTrailingNewline: 2, autoNormalizeLineEndings: false })
    }
  },
  addToOpenedFiles: vi.fn(),
  openFolder: vi.fn()
})
const restoredTabs = (): ReturnType<typeof savedTab>[] => {
  const load = send.mock.calls.find(([channel]) => channel === 'mt::load-state')
  if (!load) throw new Error('No restored state delivered to renderer')
  return load[1].tabs
}
const restore = async(tabs: Array<Record<string, unknown>>, window = harness()): Promise<ReturnType<typeof harness>> => {
  readFileSync.mockReturnValue(JSON.stringify({ tabs, project: null }))
  restoreAllState.call(window)
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith('mt::load-state', expect.anything()))
  return window
}

describe('saved session disk restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadMarkdownFile.mockReset().mockResolvedValue(diskDocument())
  })

  it('reloads saved content and discarded save options from disk', async() => {
    const tab = savedTab()
    await restore([tab])
    expect(restoredTabs()[0]).toMatchObject({ ...diskDocument(), isSaved: true })
    expect(restoredTabs()[0]).toMatchObject({ id: tab.id, history: tab.history, cursor: tab.cursor })
  })

  it('reloads disk save options even if the text has not changed', async() => {
    const tab = { ...savedTab(), markdown: diskDocument().markdown }
    await restore([tab])
    expect(restoredTabs()[0]).toMatchObject(diskDocument())
  })

  it('preserves unsaved content, save options, ID, history and cursor', async() => {
    const tab = { ...savedTab(), isSaved: false }
    await restore([tab])
    expect(restoredTabs()[0]).toEqual(tab)
  })

  it('retains a saved recovery copy as unsaved if its disk file cannot be read', async() => {
    const tab = savedTab()
    loadMarkdownFile.mockRejectedValue(new Error('ENOENT: missing disk file'))
    await restore([tab])
    expect(restoredTabs()[0]).toEqual({ ...tab, isSaved: false })
    expect(send).toHaveBeenCalledWith('mt::show-notification', expect.objectContaining({
      type: 'error', message: 'ENOENT: missing disk file'
    }))
  })

  it('retains untitled drafts without attempting a disk reload', async() => {
    const draft = { ...savedTab(), pathname: '', filename: 'Untitled', isSaved: false }
    await restore([draft])
    expect(loadMarkdownFile).not.toHaveBeenCalled()
    expect(restoredTabs()[0]).toEqual(draft)
  })

  it('waits for every disk reload before returning a mixed saved and unsaved session', async() => {
    const saved = savedTab()
    const unsaved = { ...savedTab(), id: 'unsaved-tab', pathname: '/notes/draft.md', isSaved: false }
    let complete!: (value: ReturnType<typeof diskDocument>) => void
    loadMarkdownFile
      .mockResolvedValueOnce(diskDocument())
      .mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    readFileSync.mockReturnValue(JSON.stringify({ tabs: [saved, unsaved] }))
    restoreAllState.call(harness())
    await Promise.resolve()
    expect(send).not.toHaveBeenCalledWith('mt::load-state', expect.anything())
    complete({ ...diskDocument(), pathname: unsaved.pathname })
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('mt::load-state', expect.anything()))
    expect(restoredTabs()).toEqual([{ ...saved, ...diskDocument() }, unsaved])
  })
})

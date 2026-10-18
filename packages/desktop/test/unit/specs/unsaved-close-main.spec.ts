import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UnsavedFile } from '@shared/types/files'

const {
  handlers,
  fromWebContents,
  showMessageBox,
  showSaveDialog,
  writeMarkdownFile,
  emit,
  send
} = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  fromWebContents: vi.fn(),
  showMessageBox: vi.fn(),
  showSaveDialog: vi.fn(),
  writeMarkdownFile: vi.fn(),
  emit: vi.fn(),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents },
  app: { quit: vi.fn() },
  dialog: { showMessageBox, showSaveDialog },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  ipcMain: {
    on: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    emit
  }
}))
vi.mock('electron-log', () => ({ default: { error: vi.fn() } }))
vi.mock('common/filesystem', () => ({ isDirectory: vi.fn(), isFile: vi.fn(), exists: vi.fn() }))
vi.mock('main_renderer/menu/actions/marktext', () => ({ checkUpdates: vi.fn(), userSetting: vi.fn() }))
vi.mock('main_renderer/menu/actions/view', () => ({ showTabBar: vi.fn() }))
vi.mock('main_renderer/commands', () => ({ COMMANDS: {} }))
vi.mock('main_renderer/config', () => ({ EXTENSION_HASN: {}, PANDOC_EXTENSIONS: [], URL_REG: /^https:/ }))
vi.mock('main_renderer/filesystem', () => ({
  normalizeAndResolvePath: vi.fn(), resolveLocalLinkTarget: vi.fn(), writeFile: vi.fn()
}))
vi.mock('main_renderer/filesystem/markdown', () => ({ writeMarkdownFile }))
vi.mock('main_renderer/filesystem/renameFile', () => ({ renameFileWithoutOverwrite: vi.fn() }))
vi.mock('main_renderer/utils', () => ({
  getPath: () => '/documents', getRecommendTitleFromMarkdownString: () => ''
}))
vi.mock('main_renderer/utils/pandoc', () => ({
  default: vi.fn(),
  PANDOC_EXPORT_FORMATS: [],
  formatLinksMedia: vi.fn(),
  getPandocLanguage: vi.fn(),
  getPandocReader: vi.fn(),
  getReaderExtensions: vi.fn(),
  listLinkedMedia: vi.fn(),
  shouldMirrorMedia: vi.fn()
}))
vi.mock('main_renderer/i18n', () => ({
  t: (key: string) => key,
  getCurrentLanguage: () => 'en'
}))

await import('main_renderer/menu/actions/file')

const win = {
  id: 31,
  isDestroyed: vi.fn(() => false),
  webContents: { send }
}
const event = { sender: {} }
const file = (id: string, pathname: string | undefined = `/notes/${id}.md`): UnsavedFile => ({
  id,
  filename: `${id}.md`,
  pathname,
  markdown: `unsaved content for ${id}`,
  options: { encoding: { encoding: 'utf8', isBom: false }, lineEnding: 'lf' }
})
const untitled = (id = 'draft'): UnsavedFile => ({ ...file(id), pathname: undefined })
const invoke = async(channel: string, ...args: unknown[]): Promise<unknown> => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
  return await handler(event, ...args)
}
const expectNoClose = (): void => {
  expect(emit).not.toHaveBeenCalledWith('window-close-by-id', expect.anything())
  expect(send).not.toHaveBeenCalledWith('mt::force-close-tabs-by-id', expect.anything())
  expect(send).not.toHaveBeenCalledWith('mt::complete-unsaved-close', expect.anything())
}
const closeTargets = [
  ['window', 'mt::close-window-confirm'],
  ['tabs', 'mt::save-and-close-tabs']
] as const

describe('main-process unsaved close confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    win.isDestroyed.mockReturnValue(false)
    fromWebContents.mockReturnValue(win)
    showMessageBox.mockReset().mockResolvedValue({ response: 0 })
    showSaveDialog.mockReset().mockResolvedValue({ canceled: false, filePath: '/saved/draft.md' })
    writeMarkdownFile.mockReset().mockResolvedValue(undefined)
  })

  describe.each(closeTargets)('%s close', (target, channel) => {
    const expectCloseCompletion = (files: UnsavedFile[], action: 'save' | 'discard' = 'save'): void => {
      expect(send).toHaveBeenCalledWith('mt::complete-unsaved-close', {
        target,
        action,
        files
      })
      expect(emit).not.toHaveBeenCalledWith('window-close-by-id', expect.anything())
      expect(send).not.toHaveBeenCalledWith('mt::force-close-tabs-by-id', expect.anything())
    }

    it('defaults to saving and offers a safe Cancel button', async() => {
      showMessageBox.mockResolvedValue({ response: 2 })
      await invoke(channel, [file('edited')])
      expect(showMessageBox).toHaveBeenCalledWith(win, expect.objectContaining({
        buttons: ['dialog.save', 'dialog.dontSave', 'dialog.cancel'],
        defaultId: 0,
        cancelId: 2
      }))
      expect(writeMarkdownFile).not.toHaveBeenCalled()
      expectNoClose()
    })

    it('closes without writing only after explicit Discard', async() => {
      showMessageBox.mockResolvedValue({ response: 1 })
      await invoke(channel, [file('first'), untitled('second')])
      expect(writeMarkdownFile).not.toHaveBeenCalled()
      expect(showSaveDialog).not.toHaveBeenCalled()
      expectCloseCompletion([file('first'), untitled('second')], 'discard')
    })

    it('keeps every requested tab open when Save As is canceled', async() => {
      showSaveDialog.mockResolvedValue({ canceled: true, filePath: '/ignored/draft.md' })
      await invoke(channel, [untitled(), file('later')])
      expect(showSaveDialog).toHaveBeenCalledTimes(1)
      expect(writeMarkdownFile).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalledWith('mt::tab-save-failure', expect.anything(), expect.anything())
      expectNoClose()
    })

    it('keeps the close request open when Save As returns no path', async() => {
      showSaveDialog.mockResolvedValue({ canceled: false })
      await invoke(channel, [untitled()])
      expect(writeMarkdownFile).not.toHaveBeenCalled()
      expectNoClose()
    })

    it('does not close already saved tabs if a later Save As is canceled', async() => {
      showSaveDialog.mockResolvedValue({ canceled: true })
      await invoke(channel, [file('first'), untitled(), file('later')])
      expect(writeMarkdownFile).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith('mt::tab-saved', 'first', 'unsaved content for first', file('first').options)
      expectNoClose()
    })

    it('reports write errors and retains the unsaved file', async() => {
      writeMarkdownFile.mockRejectedValue(new Error('EACCES: permission denied'))
      await invoke(channel, [file('edited'), file('later')])
      expect(writeMarkdownFile).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith('mt::tab-save-failure', 'edited', 'EACCES: permission denied')
      expect(send).not.toHaveBeenCalledWith('mt::tab-saved', 'edited', expect.anything(), expect.anything())
      expectNoClose()
    })

    it('retains all requested tabs when a later write fails', async() => {
      writeMarkdownFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce('disk full')
      await invoke(channel, [file('first'), file('second'), file('later')])
      expect(writeMarkdownFile).toHaveBeenCalledTimes(2)
      expect(send).toHaveBeenCalledWith('mt::tab-saved', 'first', 'unsaved content for first', file('first').options)
      expect(send).toHaveBeenCalledWith('mt::tab-save-failure', 'second', 'disk full')
      expectNoClose()
    })

    it('reports Save As dialog failures without closing', async() => {
      showSaveDialog.mockRejectedValue(new Error('Save dialog unavailable'))
      await invoke(channel, [untitled()])
      expect(send).toHaveBeenCalledWith('mt::tab-save-failure', 'draft', 'Save dialog unavailable')
      expectNoClose()
    })

    it('waits for every file write before closing', async() => {
      let completeFirst!: () => void
      let completeSecond!: () => void
      writeMarkdownFile
        .mockImplementationOnce(() => new Promise<void>((resolve) => { completeFirst = resolve }))
        .mockImplementationOnce(() => new Promise<void>((resolve) => { completeSecond = resolve }))
      const pending = invoke(channel, [file('first'), file('second')])
      await vi.waitFor(() => expect(writeMarkdownFile).toHaveBeenCalledTimes(1))
      expectNoClose()
      completeFirst()
      await vi.waitFor(() => expect(writeMarkdownFile).toHaveBeenCalledTimes(2))
      expectNoClose()
      completeSecond()
      await pending
      expect(writeMarkdownFile.mock.calls.map((args) => args[1])).toEqual([
        'unsaved content for first', 'unsaved content for second'
      ])
      expectCloseCompletion([file('first'), file('second')])
    })

    it('saves a new document before adding its path and closing', async() => {
      const draft = untitled()
      await invoke(channel, [draft])
      expect(writeMarkdownFile).toHaveBeenCalledWith(path.resolve('/saved/draft.md'), draft.markdown, draft.options)
      expect(send).toHaveBeenCalledWith('mt::set-pathname', {
        id: 'draft',
        pathname: path.resolve('/saved/draft.md'),
        filename: 'draft.md',
        savedMarkdown: draft.markdown,
        savedOptions: draft.options
      })
      expectCloseCompletion([draft])
    })

    it('ignores duplicate window and tab close requests while the prompt is open', async() => {
      let decide!: (value: { response: number }) => void
      showMessageBox.mockImplementationOnce(() => new Promise((resolve) => { decide = resolve }))
      const pending = invoke(channel, [file('first')])
      await invoke('mt::close-window-confirm', [file('second')])
      await invoke('mt::save-and-close-tabs', [file('second')])
      expect(showMessageBox).toHaveBeenCalledTimes(1)
      expect(writeMarkdownFile).not.toHaveBeenCalled()
      expectNoClose()
      decide({ response: 2 })
      await pending
      showMessageBox.mockResolvedValue({ response: 1 })
      await invoke(channel, [file('first')])
      expect(showMessageBox).toHaveBeenCalledTimes(2)
      expectCloseCompletion([file('first')], 'discard')
    })

    it('ignores duplicate close requests while the file is being written', async() => {
      let complete!: () => void
      writeMarkdownFile.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve }))
      const pending = invoke(channel, [file('first')])
      await vi.waitFor(() => expect(writeMarkdownFile).toHaveBeenCalledTimes(1))
      await invoke(channel, [file('first')])
      expect(showMessageBox).toHaveBeenCalledTimes(1)
      expect(writeMarkdownFile).toHaveBeenCalledTimes(1)
      expectNoClose()
      complete()
      await pending
      expectCloseCompletion([file('first')])
    })

    it('releases the close guard after a rejected confirmation dialog', async() => {
      showMessageBox.mockRejectedValueOnce(new Error('Window no longer available'))
      await invoke(channel, [file('edited')])
      expectNoClose()
      showMessageBox.mockResolvedValue({ response: 1 })
      await invoke(channel, [file('edited')])
      expect(showMessageBox).toHaveBeenCalledTimes(2)
      expectCloseCompletion([file('edited')], 'discard')
    })
  })

  it('allows independent windows to confirm while one window has a pending prompt', async() => {
    let decide!: (value: { response: number }) => void
    showMessageBox.mockImplementationOnce(() => new Promise((resolve) => { decide = resolve }))
    const pending = invoke('mt::close-window-confirm', [file('first')])
    fromWebContents.mockReturnValue({ ...win, id: 32 })
    showMessageBox.mockResolvedValue({ response: 2 })
    await invoke('mt::close-window-confirm', [file('second')])
    expect(showMessageBox).toHaveBeenCalledTimes(2)
    expectNoClose()
    decide({ response: 2 })
    await pending
  })

  it('ignores a sender with no surviving window', async() => {
    fromWebContents.mockReturnValue(null)
    await invoke('mt::close-window-confirm', [file('edited')])
    expect(showMessageBox).not.toHaveBeenCalled()
    expectNoClose()
  })

  it('does not send close IPC if a window disappeared while saving', async() => {
    writeMarkdownFile.mockImplementationOnce(async() => { win.isDestroyed.mockReturnValue(true) })
    await invoke('mt::close-window-confirm', [file('edited')])
    expect(send).not.toHaveBeenCalled()
    expectNoClose()
  })

  it.each([
    ['new document', undefined, '/saved/draft.md'],
    ['new path', '/notes/draft.md', '/saved/renamed.md'],
    ['same path', path.resolve('/saved/draft.md'), '/saved/draft.md']
  ])('acknowledges the actual Save As snapshot for a %s', async(_, pathname, destination) => {
    const draft = { ...file('draft'), pathname }
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination })
    await invoke(
      'mt::response-file-save-as', draft.id, draft.filename, draft.pathname, draft.markdown, draft.options
    )
    if (pathname === path.resolve(destination)) {
      await vi.waitFor(() => expect(send).toHaveBeenCalledWith(
        'mt::tab-saved', draft.id, draft.markdown, draft.options
      ))
    } else {
      await vi.waitFor(() => expect(send).toHaveBeenCalledWith('mt::set-pathname', {
        id: draft.id,
        pathname: path.resolve(destination),
        filename: path.basename(destination),
        savedMarkdown: draft.markdown,
        savedOptions: draft.options
      }))
    }
    expect(writeMarkdownFile).toHaveBeenCalledWith(path.resolve(destination), draft.markdown, draft.options)
    expectNoClose()
  })

  it('acknowledges the original save snapshot after an asynchronous write', async() => {
    const draft = file('edited')
    let complete!: () => void
    writeMarkdownFile.mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve }))
    const pending = invoke(
      'mt::response-file-save', draft.id, draft.filename, draft.pathname, draft.markdown, draft.options
    )
    draft.markdown = 'a newer edit after the write started'
    expect(send).not.toHaveBeenCalled()
    complete()
    await pending
    expect(send).toHaveBeenCalledWith(
      'mt::tab-saved', 'edited', 'unsaved content for edited', draft.options
    )
    expectNoClose()
  })
})

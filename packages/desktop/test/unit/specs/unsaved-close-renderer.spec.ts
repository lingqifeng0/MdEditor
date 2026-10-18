import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  const send = vi.fn()
  const preferences = { startUpAction: 'restoreAll', autoSave: false, autoSaveDelay: 5000, sourceCode: false }
  const buffered = vi.fn<(state?: unknown) => Promise<unknown>>()
  const debounced = Object.assign(vi.fn(), { cancel: vi.fn() })
  Object.assign(window, {
    path: { sep: '\\', dirname: (value: string) => value.slice(0, value.lastIndexOf('/')) },
    fileUtils: { isSamePathSync: (first: string, second: string) => first === second },
    electron: {
      clipboard: { writeText: vi.fn() },
      ipcRenderer: {
        send,
        on: (channel: string, listener: (...args: unknown[]) => unknown) => listeners.set(channel, listener)
      }
    }
  })
  return { listeners, send, preferences, buffered, debounced }
})

vi.mock('@/services/notification', () => ({ default: { notify: vi.fn(), name: 'notify' } }))
vi.mock('@/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/commands', () => ({
  FileEncodingCommand: class {},
  LineEndingCommand: class {},
  QuickOpenCommand: class {},
  TrailingNewlineCommand: class {}
}))
vi.mock('@/store/preferences', () => ({ usePreferencesStore: () => mocks.preferences }))
vi.mock('@/store/project', () => ({ useProjectStore: () => ({ projectTree: { pathname: 'C:/notes' } }) }))
vi.mock('@/store/layout', () => ({
  useLayoutStore: () => ({ SET_LAYOUT: vi.fn(), DISPATCH_LAYOUT_MENU_ITEMS: vi.fn() })
}))
vi.mock('@/store/index', () => ({ useMainStore: () => ({ platform: 'win32' }) }))
vi.mock('@/store/bufferedState', () => ({
  sendBufferedState: mocks.buffered,
  debouncedSendBufferedState: mocks.debounced
}))

import bus from '@/bus'
import notice from '@/services/notification'
import { useEditorStore } from '@/store/editor'
import { createDocumentState, getOptionsFromState } from '@/store/help'
import type { IFileState, UnsavedFile } from '@shared/types/files'

type EditorStore = ReturnType<typeof useEditorStore>

function activeFile(store: EditorStore): IFileState {
  const file = store.currentFile
  if (!file) throw new Error('Expected an active document')
  return file
}

function setupTabs(input: Array<Partial<IFileState>> = [{}]) {
  const store = useEditorStore()
  store.tabs = input.map((file, index) => createDocumentState({
    filename: `note-${index}.md`,
    pathname: `C:/notes/note-${index}.md`,
    markdown: 'Original text',
    isSaved: true,
    ...file
  }, `tab-${index}`))
  store.currentFile = store.tabs[0] ?? null
  store.updateTabIdToIndex()
  return store
}

function receive(channel: string, ...args: unknown[]) {
  const listener = mocks.listeners.get(channel)
  if (!listener) throw new Error(`Missing IPC listener: ${channel}`)
  return listener({}, ...args)
}

async function settle() {
  for (let index = 0; index < 5; index++) await Promise.resolve()
}

function deferEditUntilFlush(store: EditorStore, markdown = 'Final pending edit') {
  let pending = true
  bus.on('flush-active-editor', () => {
    if (!pending || !store.currentFile) return
    pending = false
    store.LISTEN_FOR_CONTENT_CHANGE({ id: store.currentFile.id, markdown })
  })
}

function dirtyHistory(tab: IFileState, id = 7) {
  tab.isSaved = false
  tab.history = { stack: [{ id }], index: 0, lastEditIndex: 0 }
}

function saveOptions(tab: IFileState): ReturnType<typeof getOptionsFromState> {
  return JSON.parse(JSON.stringify(getOptionsFromState(tab)))
}

function closeSnapshot(store: EditorStore, ids = store.tabs.map(tab => tab.id)): UnsavedFile[] {
  return store.tabs.filter(tab => ids.includes(tab.id)).map(tab => ({
    id: tab.id,
    filename: tab.filename,
    pathname: tab.pathname,
    markdown: tab.markdown,
    options: saveOptions(tab)
  }))
}

beforeEach(() => {
  setActivePinia(createPinia())
  bus.all.clear()
  mocks.listeners.clear()
  vi.clearAllMocks()
  mocks.buffered.mockResolvedValue(true)
  Object.assign(mocks.preferences, { startUpAction: 'restoreAll', autoSave: false, sourceCode: false })
})

afterEach(() => {
  bus.all.clear()
  vi.restoreAllMocks()
})

describe('renderer unsaved document close decisions', () => {
  it.each(['restoreAll', 'lastSession', 'blank'])('asks to save dirty files with startup preference %s', async(startUpAction) => {
    mocks.preferences.startUpAction = startUpAction
    const store = setupTabs([{ isSaved: false, markdown: 'Unsaved changes' }])
    store.LISTEN_FOR_CLOSE()

    receive('mt::ask-for-close')
    await settle()

    expect(mocks.send).toHaveBeenCalledWith('mt::close-window-confirm', [expect.objectContaining({
      id: 'tab-0', markdown: 'Unsaved changes', defaultPath: 'C:/notes'
    })])
    expect(mocks.send).not.toHaveBeenCalledWith('mt::close-window')
  })

  it('still asks to save when writing the recovery cache fails', async() => {
    const store = setupTabs([{ isSaved: false, markdown: 'Keep this edit' }])
    const error = new Error('Cache directory unavailable')
    mocks.buffered.mockRejectedValueOnce(error)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.LISTEN_FOR_CLOSE()

    receive('mt::ask-for-close')
    await settle()

    expect(log).toHaveBeenCalledWith('Failed to update buffered state before closing', error)
    expect(mocks.send).toHaveBeenCalledWith('mt::close-window-confirm', [expect.objectContaining({ markdown: 'Keep this edit' })])
    expect(mocks.send).not.toHaveBeenCalledWith('mt::close-window')
  })

  it.each([{ files: [{}] }, { files: [] }])('closes a pristine window without asking to save ($files)', async({ files }) => {
    const store = setupTabs(files)
    store.LISTEN_FOR_CLOSE()

    receive('mt::ask-for-close')
    await settle()

    expect(mocks.send).toHaveBeenCalledWith('mt::close-window')
    expect(mocks.send).not.toHaveBeenCalledWith('mt::close-window-confirm', expect.anything())
  })

  it('includes an inactive dirty tab while the active tab is saved', async() => {
    const store = setupTabs([{}, { isSaved: false, markdown: 'Inactive edit' }])
    store.LISTEN_FOR_CLOSE()

    receive('mt::ask-for-close')
    await settle()

    expect(mocks.send).toHaveBeenCalledWith('mt::close-window-confirm', [expect.objectContaining({
      id: 'tab-1', markdown: 'Inactive edit'
    })])
  })

  it('flushes a same-frame edit before caching and deciding to close', async() => {
    const store = setupTabs()
    deferEditUntilFlush(store)
    const cachedMarkdown: string[] = []
    mocks.buffered.mockImplementation(async() => {
      cachedMarkdown.push(activeFile(store).markdown)
      return true
    })
    store.LISTEN_FOR_CLOSE()

    receive('mt::ask-for-close')
    await settle()

    expect(cachedMarkdown).toEqual(['Final pending edit'])
    expect(mocks.send).toHaveBeenCalledWith('mt::close-window-confirm', [expect.objectContaining({ markdown: 'Final pending edit' })])
    expect(activeFile(store).isSaved).toBe(false)
  })

  it('flushes edits that arrive while the recovery cache acknowledgment is pending', async() => {
    const store = setupTabs()
    let resolveCache: (value: boolean) => void = () => { throw new Error('Cache promise not initialized') }
    mocks.buffered.mockReturnValueOnce(new Promise(resolve => { resolveCache = resolve }))
    store.LISTEN_FOR_CLOSE()
    receive('mt::ask-for-close')
    expect(mocks.send).not.toHaveBeenCalled()

    deferEditUntilFlush(store, 'Edited during cache write')
    resolveCache(true)
    await settle()

    expect(mocks.send).toHaveBeenCalledWith('mt::close-window-confirm', [expect.objectContaining({ markdown: 'Edited during cache write' })])
  })

  it('asks to save a pending active-tab edit instead of removing the tab', () => {
    const store = setupTabs()
    deferEditUntilFlush(store)

    store.CLOSE_TAB()

    expect(store.tabs).toHaveLength(1)
    expect(mocks.send).toHaveBeenCalledWith('mt::save-and-close-tabs', [expect.objectContaining({ markdown: 'Final pending edit' })])
  })

  it('flushes the active tab when closing a different saved tab', () => {
    const store = setupTabs([{}, {}])
    deferEditUntilFlush(store)

    store.CLOSE_TAB(store.tabs[1])

    expect(store.tabs.map(file => file.id)).toEqual(['tab-0'])
    expect(store.currentFile).toMatchObject({ markdown: 'Final pending edit', isSaved: false })
    expect(mocks.send).not.toHaveBeenCalledWith('mt::save-and-close-tabs', expect.anything())
  })

  it.each([false, true])('includes the pending edit in Save All with closeTabs=%s', (closeTabs) => {
    const store = setupTabs()
    deferEditUntilFlush(store)

    store.ASK_FOR_SAVE_ALL(closeTabs)

    expect(mocks.send).toHaveBeenCalledWith(closeTabs ? 'mt::save-and-close-tabs' : 'mt::save-tabs', [expect.objectContaining({ markdown: 'Final pending edit' })])
    expect(store.tabs).toHaveLength(1)
  })

  it('keeps a pending unsaved tab when Close Saved Tabs removes a saved sibling', () => {
    const store = setupTabs([{}, {}])
    deferEditUntilFlush(store)

    store.CLOSE_SAVED_TABS()

    expect(store.tabs.map(file => file.id)).toEqual(['tab-0'])
    expect(store.currentFile).toMatchObject({ markdown: 'Final pending edit', isSaved: false })
  })

  it('asks to save the pending active tab during Close All Tabs', () => {
    const store = setupTabs([{}, {}])
    deferEditUntilFlush(store)

    store.CLOSE_ALL_TABS()

    expect(store.tabs.map(file => file.id)).toEqual(['tab-0'])
    expect(mocks.send).toHaveBeenCalledWith('mt::save-and-close-tabs', [expect.objectContaining({ markdown: 'Final pending edit' })])
  })
})

describe('renderer save snapshot acknowledgment', () => {
  it('marks the acknowledged latest document saved and remembers its history entry', () => {
    const store = setupTabs([{ markdown: 'Saved snapshot' }])
    dirtyHistory(activeFile(store))
    store.LISTEN_FOR_SET_PATHNAME()

    receive('mt::tab-saved', 'tab-0', 'Saved snapshot')

    expect(store.currentFile).toMatchObject({ isSaved: true, lastSavedHistoryId: 7 })
  })

  it('keeps edits made after the save snapshot dirty', () => {
    const store = setupTabs([{ markdown: 'A newer edit' }])
    dirtyHistory(activeFile(store))
    store.LISTEN_FOR_SET_PATHNAME()

    receive('mt::tab-saved', 'tab-0', 'The older saved snapshot')

    expect(store.currentFile).toMatchObject({ markdown: 'A newer edit', isSaved: false, lastSavedHistoryId: -1 })
  })

  it('flushes a pending edit before accepting an older save acknowledgment', () => {
    const store = setupTabs([{ markdown: 'Saved snapshot' }])
    store.LISTEN_FOR_SET_PATHNAME()
    deferEditUntilFlush(store)

    receive('mt::tab-saved', 'tab-0', 'Saved snapshot')

    expect(store.currentFile).toMatchObject({ markdown: 'Final pending edit', isSaved: false, lastSavedHistoryId: -1 })
  })

  it('keeps an inactive tab dirty when its newer text differs from the acknowledgment', () => {
    const store = setupTabs([{}, { markdown: 'New inactive text', isSaved: false }])
    store.LISTEN_FOR_SET_PATHNAME()

    receive('mt::tab-saved', 'tab-1', 'Old inactive text')

    expect(store.tabs[1]).toMatchObject({ markdown: 'New inactive text', isSaved: false })
    expect(activeFile(store).isSaved).toBe(true)
  })

  it('compares the snapshot using the document final-newline policy', () => {
    const store = setupTabs([{ markdown: 'Saved snapshot', trimTrailingNewline: 0 }])
    dirtyHistory(activeFile(store))
    store.LISTEN_FOR_SET_PATHNAME()

    receive('mt::tab-saved', 'tab-0', 'Saved snapshot\n')

    expect(activeFile(store).isSaved).toBe(true)
  })

  it('keeps a changed encoding dirty even when the acknowledged text still matches', () => {
    const store = setupTabs()
    const options = saveOptions(activeFile(store))
    store.LISTEN_FOR_SET_PATHNAME()
    store.LISTEN_FOR_SET_ENCODING()
    bus.emit('mt::set-file-encoding', 'utf16le')

    receive('mt::tab-saved', 'tab-0', 'Original text', options)

    expect(store.currentFile).toMatchObject({ encoding: { encoding: 'utf16le' }, isSaved: false, lastSavedHistoryId: -1 })
  })

  it('keeps changed line endings dirty when a delayed save acknowledges older options', () => {
    const store = setupTabs()
    const options = saveOptions(activeFile(store))
    store.LISTEN_FOR_SET_PATHNAME()
    store.SET_LINE_ENDING('crlf')

    receive('mt::tab-saved', 'tab-0', 'Original text', options)

    expect(store.currentFile).toMatchObject({ lineEnding: 'crlf', isSaved: false, lastSavedHistoryId: -1 })
  })

  it('keeps changed final-newline options dirty when the save used the older policy', () => {
    const store = setupTabs()
    const options = saveOptions(activeFile(store))
    store.LISTEN_FOR_SET_PATHNAME()
    store.LISTEN_FOR_SET_FINAL_NEWLINE()
    bus.emit('mt::set-final-newline', 0)

    receive('mt::tab-saved', 'tab-0', 'Original text', options)

    expect(store.currentFile).toMatchObject({ trimTrailingNewline: 0, isSaved: false, lastSavedHistoryId: -1 })
  })

  it('accepts a save acknowledgment when both latest text and options match', () => {
    const store = setupTabs()
    dirtyHistory(activeFile(store))
    const options = saveOptions(activeFile(store))
    store.LISTEN_FOR_SET_PATHNAME()

    receive('mt::tab-saved', 'tab-0', 'Original text', options)

    expect(store.currentFile).toMatchObject({ isSaved: true, lastSavedHistoryId: 7 })
  })

  it('updates a newly saved pathname while retaining newer unsaved text', () => {
    const store = setupTabs([{ pathname: '', filename: 'Untitled-1', markdown: 'Later edit' }])
    dirtyHistory(activeFile(store))
    store.LISTEN_FOR_SET_PATHNAME()

    receive('mt::set-pathname', {
      id: 'tab-0', pathname: 'C:/notes/new-file.md', filename: 'new-file.md', savedMarkdown: 'Save As snapshot'
    })

    expect(store.currentFile).toMatchObject({
      filename: 'new-file.md', pathname: 'C:/notes/new-file.md', markdown: 'Later edit', isSaved: false, lastSavedHistoryId: -1
    })
  })

  it('marks Save As saved when the assigned pathname acknowledges the latest text', () => {
    const store = setupTabs([{ pathname: '', markdown: 'Save As snapshot' }])
    dirtyHistory(activeFile(store))
    store.LISTEN_FOR_SET_PATHNAME()

    receive('mt::set-pathname', {
      id: 'tab-0', pathname: 'C:/notes/new-file.md', filename: 'new-file.md', savedMarkdown: 'Save As snapshot'
    })

    expect(store.currentFile).toMatchObject({ pathname: 'C:/notes/new-file.md', isSaved: true })
  })

  it('retains newer save options while assigning a pathname from an older Save As', () => {
    const store = setupTabs([{ pathname: '', markdown: 'Save As snapshot' }])
    const options = saveOptions(activeFile(store))
    store.LISTEN_FOR_SET_PATHNAME()
    store.LISTEN_FOR_SET_ENCODING()
    bus.emit('mt::set-file-encoding', 'utf16le')

    receive('mt::set-pathname', {
      id: 'tab-0', pathname: 'C:/notes/new-file.md', filename: 'new-file.md', savedMarkdown: 'Save As snapshot', savedOptions: options
    })

    expect(store.currentFile).toMatchObject({ pathname: 'C:/notes/new-file.md', encoding: { encoding: 'utf16le' }, isSaved: false })
  })

  it('does not treat a pathname-only rename as a save', () => {
    const store = setupTabs([{ isSaved: false }])
    store.LISTEN_FOR_SET_PATHNAME()

    receive('mt::set-pathname', {
      id: 'tab-0', pathname: 'C:/notes/renamed.md', filename: 'renamed.md', preserveSavedState: true
    })

    expect(store.currentFile).toMatchObject({ pathname: 'C:/notes/renamed.md', isSaved: false })
  })

  it('retains unsaved state and a visible error after a failed write', () => {
    const store = setupTabs()
    store.LISTEN_FOR_SET_PATHNAME()

    receive('mt::tab-save-failure', 'tab-0', 'Permission denied')

    expect(activeFile(store).isSaved).toBe(false)
    expect(activeFile(store).notifications).toEqual([expect.objectContaining({ style: 'crit' })])
  })
})

describe('document save-option dirty state', () => {
  it.each([
    { name: 'line ending', update: (store: EditorStore) => store.SET_LINE_ENDING('crlf') },
    {
      name: 'encoding',
      update: (store: EditorStore) => {
        store.LISTEN_FOR_SET_ENCODING()
        bus.emit('mt::set-file-encoding', 'utf16le')
      }
    },
    {
      name: 'final newline',
      update: (store: EditorStore) => {
        store.LISTEN_FOR_SET_FINAL_NEWLINE()
        bus.emit('mt::set-final-newline', 0)
      }
    }
  ])('does not clear an unsaved $name option when unchanged content history is reported', ({ update }) => {
    const store = setupTabs()
    activeFile(store).history = { stack: [{ id: 0 }], index: 0, lastEditIndex: 0 }
    update(store)

    store.LISTEN_FOR_CONTENT_CHANGE({
      id: 'tab-0', markdown: 'Original text', history: { stack: [{ id: 0 }], index: 0, lastEditIndex: 0 }
    })

    expect(store.currentFile).toMatchObject({ isSaved: false, lastSavedHistoryId: -1 })
  })

  it.each([true, false])('changing line ending leaves isSaved=false from initial isSaved=%s', (isSaved) => {
    const store = setupTabs([{ isSaved }])

    store.SET_LINE_ENDING('crlf')

    expect(store.currentFile).toMatchObject({ lineEnding: 'crlf', isSaved: false })
  })

  it.each([true, false])('changing encoding leaves isSaved=false from initial isSaved=%s', (isSaved) => {
    const store = setupTabs([{ isSaved }])
    store.LISTEN_FOR_SET_ENCODING()

    bus.emit('mt::set-file-encoding', 'utf16le')

    expect(store.currentFile).toMatchObject({ encoding: { encoding: 'utf16le' }, isSaved: false })
  })

  it.each([true, false])('changing final-newline policy leaves isSaved=false from initial isSaved=%s', (isSaved) => {
    const store = setupTabs([{ isSaved }])
    store.LISTEN_FOR_SET_FINAL_NEWLINE()

    bus.emit('mt::set-final-newline', 1)

    expect(store.currentFile).toMatchObject({ trimTrailingNewline: 1, isSaved: false })
  })

  it('still asks to save after changing a document option following a successful save', async() => {
    const store = setupTabs()
    store.LISTEN_FOR_SET_PATHNAME()
    receive('mt::tab-saved', 'tab-0', 'Original text')
    store.SET_LINE_ENDING('crlf')
    store.LISTEN_FOR_CLOSE()

    receive('mt::ask-for-close')
    await settle()

    expect(mocks.send).toHaveBeenCalledWith('mt::close-window-confirm', [expect.objectContaining({ options: expect.objectContaining({ lineEnding: 'crlf' }) })])
  })
})

describe('renderer confirmed close completion', () => {
  it('cancels pending dirty-cache updates before persisting a discard snapshot', async() => {
    const store = setupTabs([{ isSaved: false, markdown: 'Discard this edit' }])
    const files = closeSnapshot(store)
    mocks.buffered.mockImplementationOnce(async() => {
      expect(mocks.debounced.cancel).toHaveBeenCalledOnce()
      return true
    })

    await store.COMPLETE_UNSAVED_CLOSE({ target: 'window', action: 'discard', files })

    expect(mocks.send).toHaveBeenCalledWith('mt::close-window')
    expect(store.currentFile).toMatchObject({ markdown: 'Discard this edit', isSaved: false })
  })

  it('durably writes saved state before completing window close through IPC', async() => {
    const store = setupTabs([{ isSaved: false, markdown: 'Saved edit' }])
    const files = closeSnapshot(store)
    store.LISTEN_FOR_SET_PATHNAME()
    store.LISTEN_FOR_SAVE_CLOSE()
    receive('mt::tab-saved', 'tab-0', activeFile(store).markdown, saveOptions(activeFile(store)))
    let resolveCache: (value: boolean) => void = () => { throw new Error('Cache promise not initialized') }
    mocks.buffered.mockReturnValueOnce(new Promise(resolve => { resolveCache = resolve }))

    receive('mt::complete-unsaved-close', { target: 'window', action: 'save', files })

    expect(mocks.send).not.toHaveBeenCalledWith('mt::close-window')
    expect(mocks.buffered).toHaveBeenCalledWith(expect.objectContaining({
      tabs: [expect.objectContaining({ id: 'tab-0', markdown: 'Saved edit', isSaved: true })]
    }))
    resolveCache(true)
    await settle()

    expect(mocks.send).toHaveBeenCalledWith('mt::close-window')
  })

  it('marks discarded saved paths clean only in the cached snapshot and drops untitled drafts', async() => {
    const store = setupTabs([
      { isSaved: false, markdown: 'Discard file edit' },
      { isSaved: false, pathname: '', filename: 'Untitled-1', markdown: 'Discard untitled draft' },
      { markdown: 'Saved sibling' }
    ])
    store.currentFile = store.tabs[1] ?? null
    const files = closeSnapshot(store, ['tab-0', 'tab-1'])

    await store.COMPLETE_UNSAVED_CLOSE({ target: 'window', action: 'discard', files })

    expect(mocks.buffered).toHaveBeenCalledWith(expect.objectContaining({
      tabs: [
        expect.objectContaining({ id: 'tab-0', markdown: 'Discard file edit', isSaved: true }),
        expect.objectContaining({ id: 'tab-2', markdown: 'Saved sibling', isSaved: true })
      ],
      currentFileId: 'tab-0'
    }))
    expect(store.tabs).toHaveLength(3)
    expect(store.tabs[0]).toMatchObject({ markdown: 'Discard file edit', isSaved: false })
    expect(store.tabs[1]).toMatchObject({ markdown: 'Discard untitled draft', isSaved: false })
    expect(mocks.send).toHaveBeenCalledWith('mt::close-window')
  })

  it.each(['save', 'discard'] as const)('keeps a window open and reports an unsuccessful recovery write during %s', async(action) => {
    const store = setupTabs([{ isSaved: action === 'save', markdown: 'Keep this text' }])
    const files = closeSnapshot(store)
    mocks.buffered.mockRejectedValueOnce(new Error('Cannot persist session cache'))

    await store.COMPLETE_UNSAVED_CLOSE({ target: 'window', action, files })

    expect(store.tabs).toHaveLength(1)
    expect(store.currentFile).toMatchObject({ markdown: 'Keep this text', isSaved: action === 'save' })
    expect(mocks.send).not.toHaveBeenCalledWith('mt::close-window')
    expect(notice.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'Cannot persist session cache' }))
  })

  it('does not close when the recovery cache refuses the final snapshot', async() => {
    const store = setupTabs([{ isSaved: false }])
    mocks.buffered.mockResolvedValueOnce(false)

    await store.COMPLETE_UNSAVED_CLOSE({ target: 'window', action: 'discard', files: closeSnapshot(store) })

    expect(mocks.send).not.toHaveBeenCalledWith('mt::close-window')
    expect(activeFile(store).isSaved).toBe(false)
    expect(notice.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  })

  it('asks again when a save completion arrives without its document having been saved', async() => {
    const store = setupTabs([{ isSaved: false, markdown: 'Not saved yet' }])

    await store.COMPLETE_UNSAVED_CLOSE({ target: 'window', action: 'save', files: closeSnapshot(store) })

    expect(mocks.send).toHaveBeenCalledWith('mt::close-window-confirm', [expect.objectContaining({ markdown: 'Not saved yet' })])
    expect(mocks.send).not.toHaveBeenCalledWith('mt::close-window')
  })

  it.each(['save', 'discard'] as const)('asks again for an edit made while the %s prompt was open', async(action) => {
    const store = setupTabs([{ isSaved: action === 'save', markdown: 'Prompt snapshot' }])
    const files = closeSnapshot(store)
    deferEditUntilFlush(store, 'New edit after prompt')

    await store.COMPLETE_UNSAVED_CLOSE({ target: 'window', action, files })

    expect(mocks.send).toHaveBeenCalledWith('mt::close-window-confirm', [expect.objectContaining({ markdown: 'New edit after prompt' })])
    expect(mocks.send).not.toHaveBeenCalledWith('mt::close-window')
    expect(store.currentFile).toMatchObject({ markdown: 'New edit after prompt', isSaved: false })
  })

  it.each(['save', 'discard'] as const)('asks again for edits entered while the final %s cache write was pending', async(action) => {
    const store = setupTabs([{ isSaved: action === 'save', markdown: 'Prompt snapshot' }])
    const files = closeSnapshot(store)
    let resolveCache: (value: boolean) => void = () => { throw new Error('Cache promise not initialized') }
    mocks.buffered.mockReturnValueOnce(new Promise(resolve => { resolveCache = resolve }))
    const completion = store.COMPLETE_UNSAVED_CLOSE({ target: 'window', action, files })
    expect(mocks.send).not.toHaveBeenCalledWith('mt::close-window')
    deferEditUntilFlush(store, 'Edit during final cache write')
    resolveCache(true)

    await completion

    expect(mocks.send).toHaveBeenCalledWith('mt::close-window-confirm', [expect.objectContaining({ markdown: 'Edit during final cache write' })])
    expect(mocks.send).not.toHaveBeenCalledWith('mt::close-window')
    expect(store.currentFile).toMatchObject({ markdown: 'Edit during final cache write', isSaved: false })
  })

  it('asks again for a newly dirty tab outside the window-close prompt snapshot', async() => {
    const store = setupTabs([{ isSaved: false, markdown: 'Prompt snapshot' }, {}])
    const files = closeSnapshot(store, ['tab-0'])
    store.LISTEN_FOR_CONTENT_CHANGE({ id: 'tab-1', markdown: 'Another newly dirty tab' })

    await store.COMPLETE_UNSAVED_CLOSE({ target: 'window', action: 'discard', files })

    expect(mocks.send).toHaveBeenCalledWith('mt::close-window-confirm', [
      expect.objectContaining({ id: 'tab-0', markdown: 'Prompt snapshot' }),
      expect.objectContaining({ id: 'tab-1', markdown: 'Another newly dirty tab' })
    ])
    expect(mocks.send).not.toHaveBeenCalledWith('mt::close-window')
  })

  it('does not discard options changed while the confirmation was open', async() => {
    const store = setupTabs([{ isSaved: false }])
    const files = closeSnapshot(store)
    store.SET_LINE_ENDING('crlf')

    await store.COMPLETE_UNSAVED_CLOSE({ target: 'window', action: 'discard', files })

    expect(mocks.send).toHaveBeenCalledWith('mt::close-window-confirm', [expect.objectContaining({ options: expect.objectContaining({ lineEnding: 'crlf' }) })])
    expect(mocks.send).not.toHaveBeenCalledWith('mt::close-window')
  })

  it('closes only the confirmed discarded tabs and preserves a dirty sibling', async() => {
    const store = setupTabs([{ isSaved: false, markdown: 'Discard this tab' }, { isSaved: false, markdown: 'Keep sibling tab' }])
    const files = closeSnapshot(store, ['tab-0'])

    await store.COMPLETE_UNSAVED_CLOSE({ target: 'tabs', action: 'discard', files })

    expect(store.tabs.map(tab => tab.id)).toEqual(['tab-1'])
    expect(store.currentFile).toMatchObject({ markdown: 'Keep sibling tab', isSaved: false })
    expect(mocks.send).not.toHaveBeenCalledWith('mt::close-window')
  })

  it('closes the successfully saved tab without discarding a different dirty tab', async() => {
    const store = setupTabs([{ markdown: 'Saved target tab' }, { isSaved: false, markdown: 'Keep dirty sibling' }])
    const files = closeSnapshot(store, ['tab-0'])

    await store.COMPLETE_UNSAVED_CLOSE({ target: 'tabs', action: 'save', files })

    expect(store.tabs.map(tab => tab.id)).toEqual(['tab-1'])
    expect(store.currentFile).toMatchObject({ markdown: 'Keep dirty sibling', isSaved: false })
  })

  it('asks again rather than closing a tab changed after its confirmation', async() => {
    const store = setupTabs([{ isSaved: false, markdown: 'Prompt snapshot' }])
    const files = closeSnapshot(store)
    deferEditUntilFlush(store, 'Later tab edit')

    await store.COMPLETE_UNSAVED_CLOSE({ target: 'tabs', action: 'discard', files })

    expect(store.tabs).toHaveLength(1)
    expect(mocks.send).toHaveBeenCalledWith('mt::save-and-close-tabs', [expect.objectContaining({ markdown: 'Later tab edit' })])
  })
})

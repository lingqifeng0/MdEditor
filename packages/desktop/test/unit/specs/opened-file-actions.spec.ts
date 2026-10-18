import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import path from 'pathe'
import type { IFileState } from '@shared/types/files'

const { send, handlers, popup } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const send = vi.fn()
  Object.defineProperty(window, 'path', {
    configurable: true,
    writable: true,
    value: { sep: '/', dirname: (p: string) => p }
  })
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      process: { platform: 'darwin' },
      clipboard: { writeText: vi.fn() },
      ipcRenderer: {
        send,
        on: (channel: string, listener: (...args: unknown[]) => void) => {
          handlers.set(channel, listener)
          return () => handlers.delete(channel)
        }
      }
    }
  })
  Object.defineProperty(window, 'fileUtils', {
    configurable: true,
    value: { isSamePathSync: (a: string, b: string) => a === b }
  })
  return { send, handlers, popup: vi.fn() }
})

vi.mock('@/services/notification', () => ({ default: { notify: vi.fn() } }))
vi.mock('@/store/bufferedState', () => ({ debouncedSendBufferedState: vi.fn(), sendBufferedState: vi.fn() }))
vi.mock('@/contextMenu/popupMenu', () => ({ popupContextMenu: popup }))
vi.mock('path', () => import('pathe'))

import { useEditorStore } from '@/store/editor'
import { defaultFileState } from '@/store/help'
import { getOptionsFromState } from '@/store/help'
import { usePreferencesStore } from '@/store/preferences'
import { showContextMenu } from '@/contextMenu/tabs'
import bus from '@/bus'

const file = (id: string, overrides: Partial<IFileState> = {}): IFileState => ({
  ...structuredClone(defaultFileState),
  id,
  filename: `${id}.md`,
  pathname: `/notes/${id}.md`,
  markdown: `buffer for ${id}`,
  ...overrides
})

describe('opened file actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.assign(window.path, path)
    Object.assign(window.electron.process, { platform: 'darwin' })
    send.mockClear()
    popup.mockClear()
    handlers.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('allows naming an Untitled buffer and disables revealing its nonexistent file', () => {
    showContextMenu({ clientX: 12, clientY: 30 }, { id: 'draft', pathname: '' })
    const items = popup.mock.calls[0]?.[0] as Array<{ id?: string, enabled?: boolean, label?: string }>
    expect(items.find(item => item.id === 'renameFile')?.enabled).not.toBe(false)
    expect(items.find(item => item.id === 'showInFolder')).toMatchObject({ enabled: false })
    expect(items.find(item => item.id === 'showInFolder')?.label).toContain('Save the file first')
  })

  it('routes context menu clicks to the tab that was clicked', () => {
    const emit = vi.spyOn(bus, 'emit')
    showContextMenu({ clientX: 12, clientY: 30 }, { id: 'inactive', pathname: '/notes/inactive.md' })
    const items = popup.mock.calls[0]?.[0] as Array<{ id?: string, click?: () => void }>
    items.find(item => item.id === 'renameFile')?.click?.()
    items.find(item => item.id === 'showInFolder')?.click?.()
    expect(emit).toHaveBeenCalledWith('TABS::rename', 'inactive')
    expect(emit).toHaveBeenCalledWith('TABS::show-in-folder', 'inactive')
  })

  it.each([
    ['darwin', 'Show in Finder'],
    ['win32', 'Show in folder']
  ])('uses the %s context menu label', (platform, expected) => {
    Object.assign(window.electron.process, { platform })
    showContextMenu({ clientX: 12, clientY: 30 }, { id: 'saved', pathname: 'C:\\笔记\\saved.md' })
    const items = popup.mock.calls[0]?.[0] as Array<{ id?: string, enabled?: boolean, label?: string }>
    expect(items.find(item => item.id === 'showInFolder')).toMatchObject({ label: expected, enabled: true })
  })

  it('sends a forward-slash Windows path without losing the unsaved buffer', () => {
    Object.assign(window.electron.process, { platform: 'win32' })
    const store = useEditorStore()
    store.tabs = [file('windows', { pathname: 'C:\\课程 空格\\原名.md', filename: '原名.md', isSaved: false })]
    store.currentFile = store.tabs[0]

    expect(store.RENAME('新名', 'windows')).toBe(true)

    expect(send).toHaveBeenCalledWith('mt::rename', {
      id: 'windows', pathname: 'C:\\课程 空格\\原名.md', newPathname: 'C:/课程 空格/新名.md'
    })
    expect(store.currentFile).toMatchObject({ isSaved: false, markdown: 'buffer for windows' })
  })

  it('renames a nonactive tab without switching or replacing either buffer', () => {
    const store = useEditorStore()
    store.tabs = [file('active', { isSaved: false }), file('inactive', { isSaved: false })]
    store.currentFile = store.tabs[0]
    const emit = vi.spyOn(bus, 'emit')
    const target = store.tabs.find(tab => tab.id === 'inactive')
    if (!target) throw new Error('missing target')
    store.RENAME_FILE(target)
    expect(emit).toHaveBeenCalledWith('rename', 'inactive')
    expect(store.currentFile.id).toBe('active')

    expect(store.RENAME('基础篇-02', 'inactive')).toBe(true)
    expect(send).toHaveBeenCalledWith('mt::rename', {
      id: 'inactive',
      pathname: '/notes/inactive.md',
      newPathname: '/notes/基础篇-02.md'
    })
    expect(store.tabs.map(tab => [tab.markdown, tab.isSaved])).toEqual([
      ['buffer for active', false], ['buffer for inactive', false]
    ])
  })

  it('retains unsaved text and save status through a rename response and watcher event', () => {
    const store = useEditorStore()
    store.tabs = [file('edited', { isSaved: false, markdown: 'unsaved edit' })]
    store.currentFile = store.tabs[0]
    store.LISTEN_FOR_SET_PATHNAME()
    store.LISTEN_FOR_FILE_CHANGE()

    handlers.get('mt::set-pathname')?.({}, {
      id: 'edited', pathname: '/notes/renamed.md', filename: 'renamed.md', preserveSavedState: true
    })
    handlers.get('mt::update-file')?.({}, {
      type: 'add', change: { pathname: '/notes/renamed.md', data: { markdown: 'old saved text' } }
    })

    expect(store.currentFile).toMatchObject({
      pathname: '/notes/renamed.md', markdown: 'unsaved edit', isSaved: false
    })
    expect(window.DIRNAME).toBe('/notes')
  })

  it('still marks a real save response as saved', () => {
    const store = useEditorStore()
    store.tabs = [file('edited', { isSaved: false })]
    store.currentFile = store.tabs[0]
    store.LISTEN_FOR_SET_PATHNAME()
    handlers.get('mt::set-pathname')?.({}, { id: 'edited', pathname: '/notes/edited.md', filename: 'edited.md' })
    expect(store.currentFile.isSaved).toBe(true)
  })

  it('writes a pending auto-save to the renamed path instead of recreating the old file', () => {
    vi.useFakeTimers()
    const store = useEditorStore()
    const preferences = usePreferencesStore()
    preferences.autoSaveDelay = 50
    store.tabs = [file('edited', { isSaved: false })]
    store.currentFile = store.tabs[0]
    const tab = store.currentFile
    store.HANDLE_AUTO_SAVE({
      id: tab.id,
      filename: tab.filename,
      pathname: tab.pathname,
      markdown: tab.markdown,
      options: getOptionsFromState(tab)
    })
    store.LISTEN_FOR_SET_PATHNAME()
    handlers.get('mt::set-pathname')?.({}, {
      id: 'edited', pathname: '/notes/new-name.md', filename: 'new-name.md', preserveSavedState: true
    })
    tab.markdown = 'latest unsaved text'

    vi.advanceTimersByTime(50)

    expect(send.mock.calls.find(call => call[0] === 'mt::response-file-save')?.slice(1, 5)).toEqual([
      'edited', 'new-name.md', '/notes/new-name.md', 'latest unsaved text'
    ])
  })

  it('does not dispatch changes for an invalid name, unchanged name or closed target', () => {
    const store = useEditorStore()
    store.tabs = [file('edited')]
    store.currentFile = store.tabs[0]
    expect(store.RENAME('../escape', 'edited')).toBe(false)
    expect(store.RENAME('edited.md', 'edited')).toBe(true)
    expect(store.RENAME('other', 'gone')).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('uses the existing save dialog for a nonactive Untitled buffer', () => {
    const store = useEditorStore()
    store.tabs = [file('active'), file('draft', { pathname: '', filename: 'Untitled-1', isSaved: false })]
    store.currentFile = store.tabs[0]
    const target = store.tabs.find(tab => tab.id === 'draft')
    if (!target) throw new Error('missing target')
    store.RENAME_FILE(target)
    expect(send.mock.calls.find(call => call[0] === 'mt::response-file-save')?.slice(1, 5)).toEqual([
      'draft', 'Untitled-1', '', 'buffer for draft'
    ])
    expect(store.currentFile.id).toBe('active')
  })
})

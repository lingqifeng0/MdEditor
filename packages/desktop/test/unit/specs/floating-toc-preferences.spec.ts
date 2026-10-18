import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type ElectronStoreModule from 'electron-store'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Preference from 'main_renderer/preferences'
import { usePreferencesStore } from '@/store/preferences'
import bus from '@/bus'

const native = vi.hoisted(() => ({
  directory: '',
  handlers: new Map<string, Array<(...args: unknown[]) => void>>(),
  emit: vi.fn(),
  fromWebContents: vi.fn()
}))

vi.mock('electron', () => {
  const electron = {
    app: { getPath: () => native.directory, getVersion: () => '0.20.0' },
    ipcMain: {
      on: (channel: string, callback: (...args: unknown[]) => void) => {
        const listeners = native.handlers.get(channel) ?? []
        listeners.push(callback)
        native.handlers.set(channel, listeners)
      },
      emit: native.emit
    },
    BrowserWindow: { fromWebContents: native.fromWebContents },
    nativeTheme: { shouldUseDarkColors: false }
  }
  return { ...electron, default: electron }
})
vi.mock('electron-log', () => ({ default: { info: vi.fn(), error: vi.fn() } }))
vi.mock('@/i18n', () => ({ setLanguage: vi.fn() }))
vi.mock('electron-store', async(importOriginal) => {
  const { default: ElectronStore } = await importOriginal<{ default: typeof ElectronStoreModule }>()
  return {
    default: class extends ElectronStore {
      constructor(options: ConstructorParameters<typeof ElectronStore>[0]) {
        // Keep schema validation and disk writes real without relying on an Electron app in Vitest.
        super(Object.assign({}, options, { cwd: native.directory, projectName: 'marktext-floating-toc-test', projectVersion: '0.20.0' }))
      }
    }
  }
})

const staticDirectory = path.resolve(__dirname, '../../../static')
const defaults = JSON.parse(readFileSync(path.join(staticDirectory, 'preference.json'), 'utf8'))
const schema = JSON.parse(readFileSync(path.resolve(__dirname, '../../../src/main/preferences/schema.json'), 'utf8'))

describe('floating outline preferences and persistence', () => {
  let directory: string

  const createMainPreferences = (): Preference => {
    native.handlers.clear()
    return new Preference({ preferencesPath: directory })
  }

  const readSavedPreferences = (): Record<string, unknown> =>
    JSON.parse(readFileSync(path.join(directory, 'preferences.json'), 'utf8'))

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'marktext-floating-toc-'))
    native.directory = directory
    native.handlers.clear()
    native.emit.mockReset().mockImplementation((channel: string, ...args: unknown[]) => {
      for (const listener of native.handlers.get(channel) ?? []) listener(...args)
      return true
    })
    native.fromWebContents.mockReset()
    vi.stubGlobal('__static', staticDirectory)
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    native.handlers.clear()
    if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('marktext-floating-toc-')) {
      throw new Error(`Refusing to remove an unexpected preferences directory: ${directory}`)
    }
    rmSync(directory, { recursive: true, force: true })
  })

  it('starts enabled and unpinned with matching renderer, schema and first-start defaults', () => {
    const renderer = usePreferencesStore()
    const main = createMainPreferences()
    for (const [key, value] of [['floatingTocEnabled', true], ['floatingTocPinned', false]] as const) {
      expect(renderer[key]).toBe(value)
      expect(defaults[key]).toBe(value)
      expect(schema[key]).toMatchObject({ type: 'boolean', default: value })
      expect(main.getItem(key)).toBe(value)
      expect(readSavedPreferences()[key]).toBe(value)
    }
  })

  it('writes enabled and pinned changes through the real main IPC handler without editor mutations', () => {
    createMainPreferences()
    const sender = {}
    const send = vi.fn((channel: string, payload: unknown) => native.emit(channel, { sender }, payload))
    Object.defineProperty(window, 'electron', { configurable: true, value: { ipcRenderer: { send } } })
    const emit = vi.spyOn(bus, 'emit')
    const renderer = usePreferencesStore()
    renderer.SET_SINGLE_PREFERENCE({ type: 'floatingTocEnabled', value: false })
    renderer.SET_SINGLE_PREFERENCE({ type: 'floatingTocPinned', value: true })
    expect(send.mock.calls).toEqual([
      ['mt::set-user-preference', { floatingTocEnabled: false }],
      ['mt::set-user-preference', { floatingTocPinned: true }]
    ])
    expect(renderer.floatingTocEnabled).toBe(false)
    expect(renderer.floatingTocPinned).toBe(true)
    expect(readSavedPreferences()).toMatchObject({ floatingTocEnabled: false, floatingTocPinned: true })
    expect(native.emit).toHaveBeenCalledWith('broadcast-preferences-changed', { floatingTocEnabled: false })
    expect(native.emit).toHaveBeenCalledWith('broadcast-preferences-changed', { floatingTocPinned: true })
    expect(emit).not.toHaveBeenCalled()
    const reopened = createMainPreferences()
    expect(reopened.getAll()).toMatchObject({ floatingTocEnabled: false, floatingTocPinned: true })
  })

  it('restores persisted outline choices on the preferences bootstrap without saving them again', async() => {
    const main = createMainPreferences()
    main.setItems({ floatingTocEnabled: false, floatingTocPinned: true })
    const callbacks = new Map<string, (event: unknown, preferences: unknown) => void>()
    const sender = {}
    native.fromWebContents.mockReturnValue({
      webContents: {
        send: (channel: string, preferences: unknown) => queueMicrotask(() => callbacks.get(channel)?.({}, preferences))
      }
    })
    const send = vi.fn((channel: string) => native.emit(channel, { sender }))
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { ipcRenderer: { send, on: (channel: string, callback: (event: unknown, preferences: unknown) => void) => callbacks.set(channel, callback) } }
    })
    const renderer = usePreferencesStore()
    renderer.ASK_FOR_USER_PREFERENCE()
    await Promise.resolve()
    expect(renderer.floatingTocEnabled).toBe(false)
    expect(renderer.floatingTocPinned).toBe(true)
    expect(send.mock.calls).toEqual([['mt::ask-for-user-preference'], ['mt::ask-for-user-data']])
    expect(readSavedPreferences()).toMatchObject({ floatingTocEnabled: false, floatingTocPinned: true })
  })

  it('adds defaults to an older profile while preserving its editor width', () => {
    writeFileSync(path.join(directory, 'preferences.json'), JSON.stringify({ editorLineWidth: '930px', theme: 'dark' }))
    const main = createMainPreferences()
    expect(main.getAll()).toMatchObject({ floatingTocEnabled: true, floatingTocPinned: false, editorLineWidth: '930px', theme: 'dark' })
    expect(readSavedPreferences()).toMatchObject({ floatingTocEnabled: true, floatingTocPinned: false, editorLineWidth: '930px', theme: 'dark' })
  })

  it('starts strict note image storage enabled in renderer, schema and static defaults', () => {
    const renderer = usePreferencesStore()
    const main = createMainPreferences()
    for (const key of ['imagePreferRelativeDirectory', 'imageStrictRelativeDirectory'] as const) {
      expect(renderer[key]).toBe(true)
      expect(defaults[key]).toBe(true)
      expect(schema[key]).toMatchObject({ type: 'boolean', default: true })
      expect(main.getItem(key)).toBe(true)
      expect(readSavedPreferences()[key]).toBe(true)
    }
  })

  it('adds strict image storage to an older profile without changing its existing image preference', () => {
    writeFileSync(path.join(directory, 'preferences.json'), JSON.stringify({ imagePreferRelativeDirectory: false, editorLineWidth: '930px' }))
    const main = createMainPreferences()
    expect(main.getAll()).toMatchObject({ imageStrictRelativeDirectory: true, imagePreferRelativeDirectory: false, editorLineWidth: '930px' })
    expect(readSavedPreferences()).toMatchObject({ imageStrictRelativeDirectory: true })
  })

  it('rejects non-boolean IPC values before they change the saved outline preferences', () => {
    createMainPreferences()
    expect(() => native.emit('mt::set-user-preference', {}, { floatingTocEnabled: 'false' })).toThrow()
    expect(() => native.emit('mt::set-user-preference', {}, { floatingTocPinned: 1 })).toThrow()
    expect(readSavedPreferences()).toMatchObject({ floatingTocEnabled: true, floatingTocPinned: false })
  })

  it('persists toolbar ordering through the real IPC route, reopening and old-profile migration', () => {
    writeFileSync(path.join(directory, 'preferences.json'), JSON.stringify({ editorLineWidth: '930px', theme: 'dark' }))
    const main = createMainPreferences()
    expect(main.getItem('toolbarButtonOrder')).toEqual([])
    expect(usePreferencesStore().toolbarButtonOrder).toEqual([])
    native.emit('mt::set-user-preference', {}, { toolbarButtonOrder: ['clear', 'mark'] })
    expect(readSavedPreferences()).toMatchObject({ toolbarButtonOrder: ['clear', 'mark'], editorLineWidth: '930px', theme: 'dark' })
    expect(native.emit).toHaveBeenCalledWith('broadcast-preferences-changed', { toolbarButtonOrder: ['clear', 'mark'] })
    expect(createMainPreferences().getItem('toolbarButtonOrder')).toEqual(['clear', 'mark'])
    expect(() => native.emit('mt::set-user-preference', {}, { toolbarButtonOrder: 'clear' })).toThrow()
    expect(readSavedPreferences().toolbarButtonOrder).toEqual(['clear', 'mark'])
  })

  it('provides complete Chinese and English labels for the floating outline controls', () => {
    const keys = ['toggle', 'enable', 'disable', 'title', 'pin', 'unpin', 'empty', 'expand', 'collapse', 'expandAll', 'collapseAll', 'top', 'bottom', 'copy', 'copied', 'search', 'searchPlaceholder']
    for (const locale of ['en', 'zh-CN']) {
      const translations = JSON.parse(readFileSync(path.join(staticDirectory, 'locales', `${locale}.json`), 'utf8'))
      expect(Object.keys(translations.floatingToc)).toEqual(keys)
      for (const key of keys) expect(translations.floatingToc[key]).toEqual(expect.any(String))
    }
  })
})

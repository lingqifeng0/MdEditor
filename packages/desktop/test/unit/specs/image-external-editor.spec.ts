import { EventEmitter } from 'node:events'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageEditorResult } from '@shared/types/ipc'
import { registerImageHandlers } from 'main_renderer/ipc/image'
import { copySelectedImage, openSelectedImageInEditor, revealSelectedImage, selectedImageElement } from '@/util/imageActions'
import { usePreferencesStore } from '@/store/preferences'
import bus from '@/bus'

const native = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  spawn: vi.fn(),
  showOpenDialog: vi.fn(),
  fromWebContents: vi.fn()
}))
vi.mock('node:child_process', () => ({ spawn: native.spawn, default: { spawn: native.spawn } }))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, callback: (...args: unknown[]) => unknown) => native.handlers.set(name, callback) },
  BrowserWindow: { fromWebContents: native.fromWebContents },
  dialog: { showOpenDialog: native.showOpenDialog },
  shell: { showItemInFolder: vi.fn() }
}))
vi.mock('main_renderer/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/i18n', () => ({ setLanguage: vi.fn() }))

interface ProbeChild extends EventEmitter {
  pid: number
  unref: ReturnType<typeof vi.fn>
}

describe('external image editor launch and renderer selection', () => {
  let work: string
  let editorPath: string
  let imagePath: string
  let notePath: string
  let owner: EventEmitter & { isDestroyed: ReturnType<typeof vi.fn> }
  let sender: { isDestroyed: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> }
  let children: ProbeChild[]

  const getHandler = (name: string): ((...args: unknown[]) => unknown) => {
    const handler = native.handlers.get(name)
    if (!handler) throw new Error(`Image handler not registered: ${name}`)
    return handler
  }

  const createChild = (): ProbeChild => {
    const child = Object.assign(new EventEmitter(), { pid: 1234, unref: vi.fn() })
    children.push(child)
    return child
  }
  const open = (src: string = pathToFileURL(imagePath).href, program: string = editorPath, documentPath: string = notePath): Promise<ImageEditorResult> =>
    getHandler('mt::image::open-in-editor')({ sender }, src, documentPath, program) as Promise<ImageEditorResult>

  beforeEach(() => {
    work = mkdtempSync(path.join(tmpdir(), 'marktext-image-editor-'))
    editorPath = path.join(work, '图片 编辑程序.exe')
    imagePath = path.join(work, '电容 空格 100% & 图.png')
    notePath = path.join(work, '中文 笔记.md')
    writeFileSync(editorPath, 'mock program; never executed')
    chmodSync(editorPath, 0o755)
    writeFileSync(imagePath, 'image bytes')
    owner = Object.assign(new EventEmitter(), { isDestroyed: vi.fn(() => false) })
    sender = { isDestroyed: vi.fn(() => false), send: vi.fn() }
    children = []
    native.handlers.clear()
    native.spawn.mockReset().mockImplementation(() => {
      const child = createChild()
      queueMicrotask(() => child.emit('spawn'))
      return child
    })
    native.fromWebContents.mockReset().mockReturnValue(owner)
    native.showOpenDialog.mockReset()
    registerImageHandlers()
  })

  afterEach(() => {
    owner.emit('closed')
    rmSync(work, { recursive: true, force: true })
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('requires a configured absolute program rather than PATH or a command string', async() => {
    expect(await open(undefined, '')).toEqual({ ok: false, errorCode: 'notConfigured' })
    for (const program of ['editor', 'relative.exe', '"' + editorPath + '"', editorPath + '\0']) {
      expect(await open(undefined, program)).toEqual({ ok: false, errorCode: 'invalidProgram' })
    }
    expect(native.spawn).not.toHaveBeenCalled()
  })

  it('rejects command scripts on Windows without adding a shell fallback', async() => {
    if (process.platform !== 'win32') return
    const script = path.join(work, 'image editor.cmd')
    writeFileSync(script, 'never execute')
    expect(await open(undefined, script)).toEqual({ ok: false, errorCode: 'invalidProgram' })
    expect(native.spawn).not.toHaveBeenCalled()
  })

  it('distinguishes an unavailable program from an image that cannot be found', async() => {
    expect(await open(undefined, path.join(work, 'gone.exe'))).toEqual({ ok: false, errorCode: 'programMissing' })
    expect(await open(path.join(work, 'gone.png'))).toEqual({ ok: false, errorCode: 'imageMissing' })
    expect(await open(work)).toEqual({ ok: false, errorCode: 'imageMissing' })
    expect(native.spawn).not.toHaveBeenCalled()
  })

  it.each(['https://example.com/a.png', 'data:image/png;base64,abc', 'blob:https://example.com/a', '//example.com/a.png'])('refuses non-local source %s', async(src) => {
    expect(await open(src)).toEqual({ ok: false, errorCode: 'nonLocalImage' })
    expect(native.spawn).not.toHaveBeenCalled()
  })

  it('requires a saved document for relative paths while accepting absolute images', async() => {
    expect(await open('image.png', editorPath, '')).toEqual({ ok: false, errorCode: 'nonLocalImage' })
    expect((await open(imagePath, editorPath, '')).ok).toBe(true)
  })

  it('passes the decoded local image as one literal argv item and waits for spawn confirmation', async() => {
    const url = pathToFileURL(imagePath)
    url.search = '?mucache=100'
    const result = await open(url.href)
    expect(result).toEqual({ ok: true, processId: 1234 })
    expect(native.spawn).toHaveBeenCalledWith(editorPath, [imagePath], { shell: false, stdio: 'ignore', detached: true, windowsHide: true })
    expect(children[0].unref).toHaveBeenCalledOnce()
    expect(readFileSync(imagePath, 'utf8')).toBe('image bytes')
  })

  it('keeps literal percent filenames ahead of decoded relative candidates', async() => {
    const literal = path.join(work, 'literal%20name.png')
    writeFileSync(literal, 'literal')
    writeFileSync(path.join(work, 'literal name.png'), 'decoded')
    expect((await open('literal%20name.png')).ok).toBe(true)
    expect(native.spawn.mock.calls[0][1]).toEqual([literal])
  })

  it('reports synchronous and asynchronous spawn failures without owner focus listeners', async() => {
    native.spawn.mockImplementationOnce(() => { throw new Error('denied') })
    expect(await open()).toEqual({ ok: false, errorCode: 'launchFailed' })
    native.spawn.mockImplementationOnce(() => {
      const child = createChild()
      queueMicrotask(() => child.emit('error', new Error('denied')))
      return child
    })
    expect(await open()).toEqual({ ok: false, errorCode: 'launchFailed' })
    expect(owner.listenerCount('focus')).toBe(0)
    expect(owner.listenerCount('closed')).toBe(0)
  })

  it('refreshes via the existing cache channel on launcher exit and returning owner focus', async() => {
    await open()
    children[0].emit('exit', 0)
    expect(sender.send).toHaveBeenCalledWith('mt::invalidate-image-cache')
    expect(owner.listenerCount('focus')).toBe(1)
    owner.emit('focus')
    expect(sender.send).toHaveBeenCalledTimes(2)
    expect(owner.listenerCount('focus')).toBe(0)
    expect(owner.listenerCount('closed')).toBe(0)
  })

  it('keeps at most one return-focus subscription per owner and removes it on close', async() => {
    await open()
    await open()
    expect(owner.listenerCount('focus')).toBe(1)
    expect(owner.listenerCount('closed')).toBe(1)
    owner.emit('closed')
    expect(owner.listenerCount('focus')).toBe(0)
    expect(owner.listenerCount('closed')).toBe(0)
    sender.isDestroyed.mockReturnValue(true)
    children[0].emit('exit', 0)
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('does not retain focus listeners when the requesting renderer closes during launch', async() => {
    sender.isDestroyed.mockReturnValue(true)
    expect((await open()).ok).toBe(true)
    expect(owner.listenerCount('focus')).toBe(0)
    expect(owner.listenerCount('closed')).toBe(0)
    children[0].emit('exit', 0)
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('uses an owner-bound executable picker and preserves canceled selection', async() => {
    const choose = getHandler('mt::image::choose-editor')
    native.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [editorPath] })
    expect(await choose({ sender }, editorPath)).toBe(editorPath)
    expect(native.showOpenDialog).toHaveBeenCalledWith(owner, expect.objectContaining({ defaultPath: editorPath, properties: ['openFile'] }))
    if (process.platform === 'win32') expect(native.showOpenDialog.mock.calls[0][1].filters).toEqual([{ name: 'Executable', extensions: ['exe'] }])
    native.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await choose({ sender }, editorPath)).toBeNull()
    native.fromWebContents.mockReturnValue(null)
    native.showOpenDialog.mockClear()
    expect(await choose({ sender }, editorPath)).toBeNull()
    expect(native.showOpenDialog).not.toHaveBeenCalled()
  })

  it('opens a directly selected HTML image using its rendered file URL', async() => {
    const root = document.createElement('div')
    const image = document.createElement('img')
    image.id = 'html-image'
    image.src = pathToFileURL(imagePath).href + '?mucache=99'
    root.appendChild(image)
    document.body.appendChild(root)
    const openInEditor = vi.fn().mockResolvedValue({ ok: true })
    Object.defineProperty(window, 'electron', { configurable: true, value: { images: { openInEditor } } })
    expect(selectedImageElement(root, 'html-image')).toBe(image)
    await openSelectedImageInEditor(root, { src: 'ignored-relative.png', imageId: '', image }, notePath, editorPath)
    expect(openInEditor).toHaveBeenCalledWith(image.src, notePath, editorPath)
  })

  it('rejects stale or foreign supplied elements for edit, copy and reveal without falling back', async() => {
    const root = document.createElement('div')
    root.innerHTML = '<span id="valid-wrapper"><img src="file:///valid.png"></span>'
    document.body.appendChild(root)
    const foreign = document.createElement('img')
    document.body.appendChild(foreign)
    const payload = { src: imagePath, imageId: 'valid-wrapper', image: foreign }
    const invoke = vi.fn()
    const openInEditor = vi.fn()
    Object.defineProperty(window, 'electron', { configurable: true, value: { images: { openInEditor }, ipcRenderer: { invoke } } })
    expect(await openSelectedImageInEditor(root, payload, notePath, editorPath)).toEqual({ ok: false, errorCode: 'staleImage' })
    expect(await copySelectedImage(root, root, payload)).toBe(false)
    expect((await revealSelectedImage(root, payload, notePath)).ok).toBe(false)
    foreign.remove()
    expect((await openSelectedImageInEditor(root, payload, notePath, editorPath)).ok).toBe(false)
    expect(invoke).not.toHaveBeenCalled()
    expect(openInEditor).not.toHaveBeenCalled()
  })

  it('persists the program preference through preferences IPC without emitting editor mutations', () => {
    setActivePinia(createPinia())
    const send = vi.fn()
    const emit = vi.spyOn(bus, 'emit')
    Object.defineProperty(window, 'electron', { configurable: true, value: { ipcRenderer: { send } } })
    const store = usePreferencesStore()
    expect(store.imageEditorPath).toBe('')
    store.SET_SINGLE_PREFERENCE({ type: 'imageEditorPath', value: editorPath })
    expect(store.imageEditorPath).toBe(editorPath)
    expect(send).toHaveBeenCalledExactlyOnceWith('mt::set-user-preference', { imageEditorPath: editorPath })
    expect(emit).not.toHaveBeenCalled()
    const defaults = JSON.parse(readFileSync(path.resolve(__dirname, '../../../static/preference.json'), 'utf8'))
    const schema = JSON.parse(readFileSync(path.resolve(__dirname, '../../../src/main/preferences/schema.json'), 'utf8'))
    expect(defaults.imageEditorPath).toBe('')
    expect(schema.imageEditorPath).toMatchObject({ type: 'string', default: '' })
  })
})

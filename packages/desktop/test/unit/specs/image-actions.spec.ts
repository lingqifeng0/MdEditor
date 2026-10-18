import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ImageRevealResult } from '@shared/types/ipc'
import { localImagePathCandidates } from 'common/imageFilePath'
import { copySelectedImage, revealSelectedImage, visibleImagePoint } from '@/util/imageActions'
import { registerImageHandlers } from 'main_renderer/ipc/image'

const native = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showItemInFolder: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, callback: (...args: unknown[]) => unknown) => native.handlers.set(name, callback) },
  shell: { showItemInFolder: native.showItemInFolder }
}))

describe('image file locations and clipboard actions', () => {
  let work: string
  beforeEach(() => {
    work = mkdtempSync(path.join(tmpdir(), 'marktext-image-actions-'))
    native.handlers.clear()
    native.showItemInFolder.mockReset()
    registerImageHandlers()
  })
  afterEach(() => {
    rmSync(work, { recursive: true, force: true })
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('resolves relative paths from the Markdown directory and preserves encoded literal names first', () => {
    const note = path.join(work, '课程', '基础篇.md')
    expect(localImagePathCandidates('../assets/电容%20图.png', note)).toEqual([
      path.join(work, 'assets', '电容%20图.png'),
      path.join(work, 'assets', '电容 图.png')
    ])
  })

  it('decodes file URL Unicode and reserved characters while ignoring image cache query', () => {
    const image = path.join(work, '图 #?100%.png')
    const url = pathToFileURL(image)
    url.search = '?mucache=123'
    expect(localImagePathCandidates(url.href, '')).toEqual([image])
  })

  it.each(['https://example.com/a.png', 'data:image/png;base64,abc', 'blob:https://example.com/abc', '//example.com/a.png'])('does not reveal remote or embedded source %s', async(src) => {
    const result = await native.handlers.get('mt::image::reveal')!({}, src, path.join(work, 'note.md')) as ImageRevealResult
    expect(result.ok).toBe(false)
    expect(native.showItemInFolder).not.toHaveBeenCalled()
  })

  it('cannot anchor relative images from an unsaved document', () => {
    expect(localImagePathCandidates('assets/image.png', '')).toEqual([])
    expect(localImagePathCandidates(path.join(work, 'image.png'), '')).toEqual([path.join(work, 'image.png')])
  })

  it('reveals the real encoded relative file and selects it instead of its parent folder', async() => {
    mkdirSync(path.join(work, 'assets'))
    const image = path.join(work, 'assets', '电容 图.png')
    writeFileSync(image, 'fixture')
    const result = await native.handlers.get('mt::image::reveal')!({}, 'assets/电容%20图.png', path.join(work, '基础篇.md'))
    expect(result).toEqual({ ok: true })
    expect(native.showItemInFolder).toHaveBeenCalledWith(image)
  })

  it('reports missing files and never opens a directory as an image', async() => {
    const reveal = native.handlers.get('mt::image::reveal')!
    expect((await reveal({}, path.join(work, 'missing.png'), '') as ImageRevealResult).ok).toBe(false)
    expect((await reveal({}, work, '') as ImageRevealResult).ok).toBe(false)
    expect(native.showItemInFolder).not.toHaveBeenCalled()
  })

  it('copies through the requesting WebContents and rejects invalid coordinates', () => {
    const copy = native.handlers.get('mt::clipboard::copy-image-at')!
    const sender = { copyImageAt: vi.fn() }
    expect(copy({ sender }, 10.4, 23.8)).toBe(true)
    expect(sender.copyImageAt).toHaveBeenCalledWith(10, 24)
    sender.copyImageAt.mockClear()
    expect(copy({ sender }, -1, 5)).toBe(false)
    expect(copy({ sender }, NaN, 5)).toBe(false)
    expect(sender.copyImageAt).not.toHaveBeenCalled()
  })

  const renderedImage = () => {
    const root = document.createElement('div')
    root.innerHTML = '<span id="selected-image"><img></span>'
    document.body.appendChild(root)
    const image = root.querySelector('img')!
    Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 640 } })
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, -100, 640, 480))
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 20, 700, 400))
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => image) })
    return { root, image }
  }

  it('copies a visible point even when the image extends above the viewport', async() => {
    const { root, image } = renderedImage()
    const copyImageAt = vi.fn().mockResolvedValue(true)
    Object.defineProperty(window, 'electron', { configurable: true, value: { clipboard: { copyImageAt } } })
    const point = visibleImagePoint(image, root)!
    expect(point.y).toBeGreaterThanOrEqual(20)
    expect(point.y).toBeLessThanOrEqual(380)
    expect(await copySelectedImage(root, root, { imageId: 'selected-image', src: 'assets/image.png' })).toBe(true)
    expect(copyImageAt).toHaveBeenCalledWith(point.x, point.y)
  })

  it('avoids a toolbar covering the image center and refuses stale images from another editor', async() => {
    const { root, image } = renderedImage()
    const cover = document.createElement('button')
    const center = visibleImagePoint(image, root)!
    vi.mocked(document.elementFromPoint).mockImplementation((x, y) => x === center.x && y === center.y ? cover : image)
    expect(visibleImagePoint(image, root)).not.toEqual(center)
    const otherRoot = document.createElement('div')
    expect(await copySelectedImage(otherRoot, otherRoot, { imageId: 'selected-image', src: 'assets/image.png' })).toBe(false)
  })

  it('reveals the rendered file URL instead of resolving relative markup against the app bundle', async() => {
    const { root, image } = renderedImage()
    const src = pathToFileURL(path.join(work, '电容 图.png')).href + '?mucache=5'
    image.src = src
    const invoke = vi.fn().mockResolvedValue({ ok: true })
    Object.defineProperty(window, 'electron', { configurable: true, value: { ipcRenderer: { invoke } } })
    await revealSelectedImage(root, { imageId: 'selected-image', src: 'assets/电容%20图.png' }, path.join(work, '笔记.md'))
    expect(invoke).toHaveBeenCalledWith('mt::image::reveal', src, path.join(work, '笔记.md'))
  })
})

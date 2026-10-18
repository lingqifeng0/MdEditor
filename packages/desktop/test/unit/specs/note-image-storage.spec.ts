import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
const { move } = vi.hoisted(() => ({ move: vi.fn() }))
vi.mock('@/util/fileSystem', () => ({ moveImageToFolder: move }))
import { storeNoteImage } from '@/util/noteImageStorage'

const resolveDirectory = vi.fn()
const isFile = vi.fn()
const isImageFile = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window, { path: path.win32, electron: { images: { resolveDirectory } }, fileUtils: { isFile, isImageFile } })
  resolveDirectory.mockResolvedValue({ ok: true, directory: 'C:\\项目\\assets' })
  isFile.mockResolvedValue(true)
  isImageFile.mockResolvedValue(true)
  move.mockResolvedValue('assets\\saved.png')
})

describe('strict note image storage', () => {
  it.each(['unsaved', 'wrongParent', 'missingDirectory'])('stops before copying when %s', async errorCode => {
    resolveDirectory.mockResolvedValue({ ok: false, errorCode })
    expect(await storeNoteImage('C:\\incoming.png', '', 'assets')).toEqual({ ok: false, errorCode })
    expect(move).not.toHaveBeenCalled()
    expect(isFile).not.toHaveBeenCalled()
  })
  it('copies a local image using an existing directory and returns a portable relative path', async() => {
    expect(await storeNoteImage('C:\\incoming.png', 'C:\\项目\\项目.md', 'assets')).toMatchObject({ ok: true, src: 'assets/saved.png', pathname: 'C:\\项目\\项目.md' })
    expect(move).toHaveBeenCalledWith('C:\\项目\\项目.md', 'C:\\incoming.png', 'C:\\项目\\assets', true, 'C:\\项目\\项目.md', true, '')
  })
  it('decodes file URLs and encoded local paths without treating an actual percent filename as an escape', async() => {
    await storeNoteImage('file:///C:/incoming%20image.png', 'C:\\项目\\项目.md', 'images')
    expect(move.mock.calls[0]![1]).toBe('C:\\incoming image.png')
    isFile.mockImplementation(async(candidate: string) => candidate.includes('other image'))
    await storeNoteImage('assets/other%20image.png', 'C:\\项目\\项目.md', 'assets')
    expect(move.mock.calls[1]![1]).toBe('C:\\项目\\assets\\other image.png')
  })
  it('rejects deleted originals and reports copy failure without returning a raw src', async() => {
    isFile.mockResolvedValue(false)
    expect(await storeNoteImage('C:\\missing.png', 'C:\\项目\\项目.md', 'assets')).toMatchObject({ ok: false, errorCode: 'imageMissing' })
    isFile.mockResolvedValue(true)
    move.mockRejectedValue(new Error('no access'))
    expect(await storeNoteImage('C:\\incoming.png', 'C:\\项目\\项目.md', 'assets')).toMatchObject({ ok: false, errorCode: 'copyFailed' })
  })
  it('stores an in-memory clipboard image and checks the directory for remote sources too', async() => {
    expect(await storeNoteImage(new File(['bitmap'], 'image.png', { type: 'image/png' }), 'C:\\项目\\项目.md', 'assets')).toMatchObject({ ok: true })
    expect(await storeNoteImage('https://example.com/image.png', 'C:\\项目\\项目.md', 'assets')).toMatchObject({ ok: true, src: 'https://example.com/image.png' })
  })
  it('continues the same paste after preparation and resolves its source against the original folder', async() => {
    resolveDirectory.mockResolvedValue({ ok: false, errorCode: 'wrongParent', stem: '项目' })
    const prepare = vi.fn().mockResolvedValue({ pathname: 'C:\\项目\\项目.md', directory: 'C:\\项目\\assets' })
    expect(await storeNoteImage('old.png', 'C:\\项目.md', 'images', prepare)).toMatchObject({ ok: true, src: 'assets/saved.png', pathname: 'C:\\项目\\项目.md' })
    expect(move).toHaveBeenCalledWith('C:\\项目\\项目.md', 'C:\\old.png', 'C:\\项目\\assets', true, 'C:\\项目\\项目.md', true, '')
    expect(prepare).toHaveBeenCalledTimes(1)
  })
  it('cancels without copying after declining a directory prompt', async() => {
    resolveDirectory.mockResolvedValue({ ok: false, errorCode: 'unsaved' })
    expect(await storeNoteImage(new File(['img'], 'image.png'), '', 'assets', async() => null)).toEqual({ ok: false, errorCode: 'cancelled' })
    expect(move).not.toHaveBeenCalled()
  })
})

// @vitest-environment node
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { LocalImageWatcher } from 'main_renderer/filesystem/imageWatcher'

let fixture: string
let watcher: LocalImageWatcher
const invalidate = vi.fn()
beforeEach(async() => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'mt-image-watch-'))
  invalidate.mockReset()
  watcher = new LocalImageWatcher(invalidate)
  await mkdir(path.join(fixture, 'assets'))
})
afterEach(async() => { await watcher.close(); await rm(fixture, { force: true, recursive: true }) })

describe('local referenced image watcher', () => {
  it('refreshes after replacement, deletion, and restoration of a local image', async() => {
    const image = path.join(fixture, 'assets', 'image.png')
    await writeFile(image, 'before')
    await watcher.update(['assets/image.png'], path.join(fixture, 'note.md'))
    await writeFile(image, 'replacement')
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled(), { timeout: 4000 })
    invalidate.mockClear()
    await rm(image)
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled(), { timeout: 4000 })
    invalidate.mockClear()
    await writeFile(image, 'restored')
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled(), { timeout: 4000 })
  }, 14000)
  it('watches currently missing files, ignores unrelated images, and detaches on note switch', async() => {
    await watcher.update(['assets/missing.png', 'https://example.com/remote.png'], path.join(fixture, 'note.md'))
    await writeFile(path.join(fixture, 'assets', 'unrelated.png'), 'other')
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(invalidate).not.toHaveBeenCalled()
    await writeFile(path.join(fixture, 'assets', 'missing.png'), 'created')
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled(), { timeout: 4000 })
    await watcher.update([], '')
    invalidate.mockClear()
    await rm(path.join(fixture, 'assets', 'missing.png'))
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(invalidate).not.toHaveBeenCalled()
  }, 7000)
})

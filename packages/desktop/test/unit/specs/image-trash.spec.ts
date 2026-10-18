// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { ImageTrashLedger } from 'main_renderer/filesystem/imageTrash'

let fixture: string
let image: string
let ledger: ImageTrashLedger
const trash = vi.fn(async(pathname: string) => { await unlink(pathname) })
beforeEach(async() => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'mt-v824-trash-'))
  image = path.join(fixture, '图片 1.png')
  await writeFile(image, 'pixels')
  trash.mockClear()
  ledger = new ImageTrashLedger(trash)
})
afterEach(async() => { if (path.basename(fixture).startsWith('mt-v824-trash-')) await rm(fixture, { recursive: true, force: true }) })

describe('image file removal with undo and redo', () => {
  it('removes the actual local image and restores identical bytes on undo and redo', async() => {
    const result = await ledger.remove('图片%201.png', path.join(fixture, 'note.md'))
    expect(result.ok).toBe(true)
    if (!result.ok || !result.token) throw new Error('missing token')
    await expect(stat(image)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await ledger.reconcile(result.token, true)).toMatchObject({ ok: true })
    expect(await readFile(image, 'utf8')).toBe('pixels')
    expect(await ledger.reconcile(result.token, false)).toMatchObject({ ok: true })
    await expect(stat(image)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await ledger.reconcile(result.token, true)).toMatchObject({ ok: true })
    expect(await readFile(image, 'utf8')).toBe('pixels')
  })
  it('supports rendered file URLs with cache query strings', async() => {
    const result = await ledger.remove(`${pathToFileURL(image).href}?mucache=123`, '')
    expect(result).toMatchObject({ ok: true, token: expect.any(String) })
    expect(trash).toHaveBeenCalledWith(image)
  })
  it('does not delete a new file substituted after undo', async() => {
    const result = await ledger.remove(image, '')
    if (!result.ok || !result.token) throw new Error('missing token')
    await ledger.reconcile(result.token, true)
    await writeFile(image, 'replacement')
    expect(await ledger.reconcile(result.token, false)).toMatchObject({ ok: false })
    expect(await readFile(image, 'utf8')).toBe('replacement')
  })
  it('does not overwrite a new file substituted before undo', async() => {
    const result = await ledger.remove(image, '')
    if (!result.ok || !result.token) throw new Error('missing token')
    await writeFile(image, 'replacement')
    expect(await ledger.reconcile(result.token, true)).toMatchObject({ ok: false })
    expect(await readFile(image, 'utf8')).toBe('replacement')
  })
  it('allows removal of links whose originals are already missing or remote', async() => {
    expect(await ledger.remove('missing.png', path.join(fixture, 'note.md'))).toEqual({ ok: true })
    expect(await ledger.remove('https://example.com/a.png', '')).toEqual({ ok: true })
    expect(trash).not.toHaveBeenCalled()
  })
  it('keeps a file when native trash fails and rejects unknown history tokens', async() => {
    const failed = new ImageTrashLedger(async() => { throw new Error('busy') })
    expect(await failed.remove(image, '')).toMatchObject({ ok: false })
    expect(await readFile(image, 'utf8')).toBe('pixels')
    expect(await failed.reconcile('unknown', true)).toMatchObject({ ok: false })
  })
})

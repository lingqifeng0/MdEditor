import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageDraftLedger } from '../../../src/main/filesystem/imageDrafts'

let directory: string
let ledger: ImageDraftLedger
const data = new Uint8Array([1, 2, 3, 4])
let trash: ReturnType<typeof vi.fn<(pathname: string) => Promise<void>>>
const note = (id: string, sources: string[]) => ({ id, pathname: path.join(directory, '项目.md'), sources })
const store = (owner = '1:a') => ledger.store(owner, { noteId: owner, directory, name: 'clipboard.png', data })

beforeEach(async() => {
  directory = await mkdtemp(path.join(tmpdir(), 'marktext-image-drafts-'))
  trash = vi.fn(async(pathname: string) => { await rm(pathname) })
  ledger = new ImageDraftLedger(trash)
})
afterEach(async() => { await rm(directory, { recursive: true, force: true }) })

describe('ownership of unsaved image files', () => {
  it('removes a newly created bitmap on discard', async() => {
    const filename = await store()
    await ledger.release(['1:a'], [])
    expect(trash).toHaveBeenCalledWith(filename)
    await expect(readFile(filename)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('keeps preexisting hash matches and never overwrites them', async() => {
    const filename = path.join(directory, createHash('sha1').update(data).digest('hex') + '.png')
    await writeFile(filename, data)
    expect(await store()).toBe(filename)
    await ledger.release(['1:a'], [])
    expect(trash).not.toHaveBeenCalled()
    expect([...await readFile(filename)]).toEqual([...data])
  })
  it('commits only references in the snapshot that was actually saved', async() => {
    const kept = await store()
    const abandoned = await ledger.store('1:a', { noteId: 'a', directory, name: 'draft.png', data: new Uint8Array([5]) })
    await ledger.commit(note('a', [path.basename(kept)]))
    await ledger.release(['1:a'], [])
    expect([...await readFile(kept)]).toEqual([...data])
    expect(trash).toHaveBeenCalledWith(abandoned)
  })
  it('keeps a deduplicated file while another window owns an unsaved reference', async() => {
    const filename = await store()
    expect(await store('2:b')).toBe(filename)
    await ledger.release(['1:a'], [])
    expect(trash).not.toHaveBeenCalled()
    await ledger.release(['2:b'], [])
    expect(trash).toHaveBeenCalledWith(filename)
  })
  it('keeps a file permanently after another note saves its shared reference', async() => {
    const filename = await store()
    await store('2:b')
    await ledger.commit(note('b', [filename]))
    await ledger.release(['1:a', '2:b'], [])
    expect(trash).not.toHaveBeenCalled()
    expect([...await readFile(filename)]).toEqual([...data])
  })
  it('a canceled HTML draft only releases its additions and preserves live Markdown references', async() => {
    const first = await store()
    const second = await ledger.store('1:a', { noteId: 'a', directory, name: 'second.png', data: new Uint8Array([6]) })
    await ledger.release(['1:a'], [note('a', [first])], note('a', [first, second]))
    expect(trash).toHaveBeenCalledTimes(1)
    expect(trash).toHaveBeenCalledWith(second)
    expect([...await readFile(first)]).toEqual([...data])
  })
  it('copies a source file without making the original disposable', async() => {
    const source = path.join(directory, 'original.jpg')
    await writeFile(source, data)
    const target = await ledger.store('1:a', { noteId: 'a', directory, source })
    await ledger.release(['1:a'], [])
    expect(trash).toHaveBeenCalledWith(target)
    expect([...await readFile(source)]).toEqual([...data])
  })
  it('refuses to remove a replaced file and can retry a failed cleanup', async() => {
    const target = await store()
    await writeFile(target, new Uint8Array([99]))
    await expect(ledger.release(['1:a'], [])).rejects.toThrow('已被其他程序修改')
    expect(trash).not.toHaveBeenCalled()
    await writeFile(target, data)
    await ledger.release(['1:a'], [])
    expect(trash).toHaveBeenCalledWith(target)
  })
  it('tolerates a pending file already deleted by an explicit image action', async() => {
    const target = await store()
    await rm(target)
    await ledger.release(['1:a'], [])
    expect(trash).not.toHaveBeenCalled()
  })
  it('serializes simultaneous pastes and cleanup without orphan files', async() => {
    const first = store()
    const second = store()
    const release = ledger.release(['1:a'], [])
    expect(await first).toBe(await second)
    await release
    expect(trash).toHaveBeenCalledTimes(1)
  })
  it('cleans only owned files inside the selected directory, including encoded references', async() => {
    const nested = path.join(directory, 'assets with spaces')
    await mkdir(nested)
    const target = await ledger.store('1:a', { noteId: 'a', directory: nested, data, name: 'clipboard.png' })
    const src = encodeURI(path.relative(directory, target).replace(/\\/g, '/'))
    await ledger.commit(note('a', [src]))
    await ledger.release(['1:a'], [])
    expect([...await readFile(target)]).toEqual([...data])
  })
  it('validates all candidates before removing anything if another draft file was replaced', async() => {
    const first = await store()
    const second = await ledger.store('1:a', { noteId: 'a', directory, name: 'second.png', data: new Uint8Array([7]) })
    await writeFile(second, new Uint8Array([99]))
    await expect(ledger.release(['1:a'], [])).rejects.toThrow('已被其他程序修改')
    expect(trash).not.toHaveBeenCalled()
    expect([...await readFile(first)]).toEqual([...data])
  })
  it('restores already removed files if a later trash operation fails', async() => {
    const first = await store()
    const secondData = new Uint8Array([8])
    const second = await ledger.store('1:a', { noteId: 'a', directory, name: 'second.png', data: secondData })
    trash.mockImplementationOnce(async(pathname: string) => { await rm(pathname) }).mockRejectedValueOnce(new Error('文件正在使用'))
    await expect(ledger.release(['1:a'], [])).rejects.toThrow('文件正在使用')
    expect([...await readFile(first)]).toEqual([...data])
    expect([...await readFile(second)]).toEqual([...secondData])
    await ledger.release(['1:a'], [])
    await expect(readFile(first)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(second)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('saving an explicit only-links choice retains its new local file even without a Markdown reference', async() => {
    const target = await store()
    await ledger.retainLinks('1:a', note('a', [target]))
    await ledger.commit(note('a', []), '1:a')
    await ledger.release(['1:a'], [])
    expect([...await readFile(target)]).toEqual([...data])
    expect(trash).not.toHaveBeenCalled()
  })
  it('Don’t Save still discards new files from an unsaved only-links choice', async() => {
    const target = await store()
    await ledger.retainLinks('1:a', note('a', [target]))
    await ledger.release(['1:a'], [])
    expect(trash).toHaveBeenCalledWith(target)
  })
  it('waits for a pending save before discarding a file retained by an only-links choice', async() => {
    const target = await store()
    await ledger.retainLinks('1:a', note('a', [target]))
    let finish!: () => void
    const written = new Promise<void>(resolve => { finish = resolve })
    const save = ledger.save('1:a', note('a', []), () => written)
    const close = ledger.release(['1:a'], [])
    await Promise.resolve()
    expect(trash).not.toHaveBeenCalled()
    finish()
    await Promise.all([save, close])
    expect([...await readFile(target)]).toEqual([...data])
    expect(trash).not.toHaveBeenCalled()
  })
  it('commits the saved image snapshot but discards a later unsaved addition', async() => {
    const target = await store()
    let finish!: () => void
    const save = ledger.save('1:a', note('a', [target]), () => new Promise<void>(resolve => { finish = resolve }))
    const later = await ledger.store('1:a', { noteId: 'a', directory, name: 'later.png', data: new Uint8Array([91]) })
    const close = ledger.release(['1:a'], [])
    finish()
    await Promise.all([save, close])
    expect([...await readFile(target)]).toEqual([...data])
    expect(trash).toHaveBeenCalledWith(later)
    await expect(readFile(later)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('keeps all draft assets when a pending disk save fails during close', async() => {
    const target = await store()
    let fail!: (error: Error) => void
    const save = ledger.save('1:a', note('a', [target]), () => new Promise<void>((_resolve, reject) => { fail = reject }))
    const close = ledger.release(['1:a'], [])
    const saved = expect(save).rejects.toThrow('磁盘写入失败')
    const closed = expect(close).rejects.toThrow('磁盘写入失败')
    fail(new Error('磁盘写入失败'))
    await Promise.all([saved, closed])
    expect([...await readFile(target)]).toEqual([...data])
    expect(trash).not.toHaveBeenCalled()
  })
})

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { prepareNoteImageDirectory } from 'main_renderer/filesystem/noteImageDirectory'
import type { PrepareImageDirectoryRequest } from '@shared/types/ipc'

let fixture: string
const options: PrepareImageDirectoryRequest['options'] = { encoding: { encoding: 'utf8', isBom: false }, lineEnding: 'lf', adjustLineEndingOnSave: false }
const request = (pathname = '', destination?: string): PrepareImageDirectoryRequest => ({ pathname, destination, markdown: '# 草稿\n', resources: [], options })
beforeEach(async() => { fixture = await mkdtemp(path.join(os.tmpdir(), 'mt-v824-directory-')) })
afterEach(async() => { if (path.basename(fixture).startsWith('mt-v824-directory-')) await rm(fixture, { recursive: true, force: true }) })

describe('confirmed same-named note folder preparation', () => {
  it('saves a new note in a same-named folder with fixed assets', async() => {
    const result = await prepareNoteImageDirectory(request('', path.join(fixture, '新 笔记.md')))
    const pathname = path.join(fixture, '新 笔记', '新 笔记.md')
    expect(result).toEqual({ ok: true, pathname, directory: path.join(fixture, '新 笔记', 'assets') })
    expect(await readFile(pathname, 'utf8')).toBe('# 草稿\n')
  })
  it('does not create a double same-named folder for an already chosen note directory', async() => {
    const pathname = path.join(fixture, '项目', '项目.md')
    expect(await prepareNoteImageDirectory(request('', pathname))).toMatchObject({ ok: true, pathname })
    expect((await stat(path.join(fixture, '项目', 'assets'))).isDirectory()).toBe(true)
  })
  it('creates missing assets without overwriting the saved Markdown with a dirty draft', async() => {
    const pathname = path.join(fixture, '项目', '项目.md')
    await mkdir(path.dirname(pathname))
    await writeFile(pathname, 'saved')
    expect(await prepareNoteImageDirectory(request(pathname))).toMatchObject({ ok: true, pathname })
    expect(await readFile(pathname, 'utf8')).toBe('saved')
  })
  it('moves only the note and preserves existing relative image files and source Markdown', async() => {
    const pathname = path.join(fixture, '项目.md')
    await mkdir(path.join(fixture, 'assets'))
    await writeFile(path.join(fixture, 'assets', '图 1.png'), 'pixels')
    await writeFile(pathname, '![](assets/图%201.png)\r\n')
    const result = await prepareNoteImageDirectory({ ...request(pathname), resources: ['assets/图%201.png'] })
    expect(result.ok).toBe(true)
    expect(await readFile(path.join(fixture, '项目', '项目.md'), 'utf8')).toBe('![](assets/图%201.png)\r\n')
    expect(await readFile(path.join(fixture, '项目', 'assets', '图 1.png'), 'utf8')).toBe('pixels')
    expect(await readFile(path.join(fixture, 'assets', '图 1.png'), 'utf8')).toBe('pixels')
    await expect(stat(pathname)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('refuses an existing target note without changing either original', async() => {
    const pathname = path.join(fixture, '项目.md')
    const target = path.join(fixture, '项目', '项目.md')
    await mkdir(path.dirname(target))
    await writeFile(target, 'other')
    await writeFile(pathname, 'original')
    expect(await prepareNoteImageDirectory(request(pathname))).toMatchObject({ ok: false })
    expect(await readFile(target, 'utf8')).toBe('other')
    expect(await readFile(pathname, 'utf8')).toBe('original')
  })
  it('rolls back newly created files when an existing image target conflicts', async() => {
    const pathname = path.join(fixture, '项目.md')
    await mkdir(path.join(fixture, '项目', 'images'), { recursive: true })
    await writeFile(path.join(fixture, 'one.png'), 'copy')
    await mkdir(path.join(fixture, 'images'))
    await writeFile(path.join(fixture, 'images', 'two.png'), 'old')
    await writeFile(path.join(fixture, '项目', 'images', 'two.png'), 'new')
    await writeFile(pathname, 'note')
    expect(await prepareNoteImageDirectory({ ...request(pathname), resources: ['one.png', 'images/two.png'] })).toMatchObject({ ok: false })
    await expect(stat(path.join(fixture, '项目', 'one.png'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(path.join(fixture, '项目', 'assets'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(pathname, 'utf8')).toBe('note')
    expect(await readFile(path.join(fixture, '项目', 'images', 'two.png'), 'utf8')).toBe('new')
  })
  it('reports an assets file collision and leaves the note untouched', async() => {
    const pathname = path.join(fixture, '项目', '项目.md')
    await mkdir(path.dirname(pathname))
    await writeFile(pathname, 'original')
    await writeFile(path.join(path.dirname(pathname), 'assets'), 'file')
    expect(await prepareNoteImageDirectory(request(pathname))).toMatchObject({ ok: false })
    expect(await readFile(pathname, 'utf8')).toBe('original')
  })
  it('writes the selected encoding and line endings for a new note', async() => {
    const pathname = path.join(fixture, '项目', '项目.md')
    expect(await prepareNoteImageDirectory({ ...request('', pathname), options: { ...options, encoding: { encoding: 'utf8', isBom: true }, lineEnding: 'crlf', adjustLineEndingOnSave: true } })).toMatchObject({ ok: true })
    const bytes = await readFile(pathname)
    expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191])
    expect(bytes.toString('utf8')).toContain('\r\n')
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile, stat, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getRenamedFilename } from 'common/filename'
import { renameFileWithoutOverwrite } from 'main_renderer/filesystem/renameFile'

const directories: string[] = []
const tempDirectory = async(): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'marktext-rename-'))
  directories.push(directory)
  return directory
}

afterEach(async() => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('file rename', () => {
  it('keeps the Markdown extension when only a title is entered', () => {
    expect(getRenamedFilename(' 基础篇-02 ', '基础篇-01.md')).toBe('基础篇-02.md')
    expect(getRenamedFilename('new.name', 'note.markdown')).toBe('new.name.markdown')
    expect(getRenamedFilename('new.md', 'note.md')).toBe('new.md')
  })

  it.each(['', ' ', '.', '..', '../x', 'a/b', 'a\\b', 'a:b', 'a\u0000b', 'CON', 'a.', '好'.repeat(85)])(
    'rejects invalid names: %s',
    name => expect(getRenamedFilename(name, 'note.md')).toBeNull()
  )

  it('preserves the original disk contents and metadata when moving the name', async() => {
    const directory = await tempDirectory()
    const src = path.join(directory, '原名.md')
    const dest = path.join(directory, '新名.md')
    await writeFile(src, 'saved disk text', { mode: 0o600 })
    const original = await stat(src)

    await renameFileWithoutOverwrite(src, dest)

    expect(await readdir(directory)).toEqual(['新名.md'])
    expect(await readFile(dest, 'utf8')).toBe('saved disk text')
    expect((await stat(dest)).ino).toBe(original.ino)
    if (process.platform !== 'win32') expect((await stat(dest)).mode & 0o777).toBe(0o600)
  })

  it('never replaces an existing destination', async() => {
    const directory = await tempDirectory()
    const src = path.join(directory, 'old.md')
    const dest = path.join(directory, 'existing.md')
    await writeFile(src, 'original')
    await writeFile(dest, 'keep this')

    await expect(renameFileWithoutOverwrite(src, dest)).rejects.toThrow()

    expect(await readFile(src, 'utf8')).toBe('original')
    expect(await readFile(dest, 'utf8')).toBe('keep this')
  })

  it.skipIf(process.platform !== 'win32')('accepts the forward-slash destination sent by the renderer', async() => {
    const directory = await tempDirectory()
    const src = path.join(directory, '原名 🧩.md')
    const dest = path.join(directory, '新名 空格.md').replace(/\\/g, '/')
    await writeFile(src, 'Windows renderer IPC contents')

    await renameFileWithoutOverwrite(src, dest)

    expect(await readdir(directory)).toEqual(['新名 空格.md'])
    expect(await readFile(dest, 'utf8')).toBe('Windows renderer IPC contents')
  })

  it.skipIf(process.platform !== 'win32')('accepts drive-letter and directory case differences', async() => {
    const directory = await tempDirectory()
    const src = path.join(directory, 'old.md')
    const dest = path.join(directory.toUpperCase(), 'new.md').replace(/\\/g, '/')
    await writeFile(src, 'keep contents')

    await renameFileWithoutOverwrite(src, dest)

    expect(await readdir(directory)).toEqual(['new.md'])
    expect(await readFile(dest, 'utf8')).toBe('keep contents')
  })

  it.skipIf(process.platform !== 'win32')('renames only the filename case without replacing its contents', async() => {
    const directory = await tempDirectory()
    const src = path.join(directory, 'Note.md')
    const dest = path.join(directory, 'NOTE.md')
    await writeFile(src, 'case-only rename')

    await renameFileWithoutOverwrite(src, dest)

    expect(await readdir(directory)).toEqual(['NOTE.md'])
    expect(await readFile(dest, 'utf8')).toBe('case-only rename')
  })

  it('rejects folder moves and extension changes before touching the source', async() => {
    const directory = await tempDirectory()
    const src = path.join(directory, 'old.md')
    await writeFile(src, 'original')

    await expect(renameFileWithoutOverwrite(src, path.join(directory, 'old.txt'))).rejects.toThrow()
    await expect(renameFileWithoutOverwrite(src, path.join(directory, 'sub', 'old.md'))).rejects.toThrow()
    expect(await readFile(src, 'utf8')).toBe('original')
  })
})

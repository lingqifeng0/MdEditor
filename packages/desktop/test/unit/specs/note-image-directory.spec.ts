// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveNoteImageDirectory } from 'common/imageDirectory'

let fixture: string
let note: string
beforeEach(async() => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'mt-note-directory-'))
  const parent = path.join(fixture, '项目')
  await mkdir(parent)
  note = path.join(parent, '项目.md')
  await writeFile(note, '# Test')
})
afterEach(async() => { await rm(fixture, { recursive: true, force: true }) })

describe('same-named note image directory', () => {
  it('rejects unsaved notes and relative document paths', async() => {
    expect(await resolveNoteImageDirectory('')).toMatchObject({ ok: false, errorCode: 'unsaved' })
    expect(await resolveNoteImageDirectory('项目.md')).toMatchObject({ ok: false, errorCode: 'unsaved' })
  })
  it('rejects a note in a differently named directory even when assets exists', async() => {
    const wrong = path.join(fixture, '项目.md')
    await writeFile(wrong, '')
    await mkdir(path.join(fixture, 'assets'))
    expect(await resolveNoteImageDirectory(wrong)).toMatchObject({ ok: false, errorCode: 'wrongParent', stem: '项目' })
  })
  it('requires a real saved file and an existing image directory', async() => {
    expect(await resolveNoteImageDirectory(note)).toMatchObject({ ok: false, errorCode: 'missingDirectory' })
    await writeFile(path.join(path.dirname(note), 'assets'), '')
    expect(await resolveNoteImageDirectory(note)).toMatchObject({ ok: false, errorCode: 'missingDirectory' })
    await rm(note)
    expect(await resolveNoteImageDirectory(note)).toMatchObject({ ok: false, errorCode: 'unsaved' })
  })
  it('accepts assets and returns its absolute path', async() => {
    const name = 'assets'
    const directory = path.join(path.dirname(note), name)
    await mkdir(directory)
    expect(await resolveNoteImageDirectory(note)).toEqual({ ok: true, directory })
  })
  it('uses assets even when an old preference still names images', async() => {
    await mkdir(path.join(path.dirname(note), 'assets'))
    await mkdir(path.join(path.dirname(note), 'images'))
    expect(await resolveNoteImageDirectory(note, 'images')).toEqual({ ok: true, directory: path.join(path.dirname(note), 'assets') })
    // eslint-disable-next-line no-template-curly-in-string -- Test expansion of a saved directory template.
    expect(await resolveNoteImageDirectory(note, '${filename}.assets')).toEqual({ ok: true, directory: path.join(path.dirname(note), 'assets') })
  })
  it.each(['images', '项目.assets'])('does not use the legacy %s folder in strict mode', async name => {
    await mkdir(path.join(path.dirname(note), name))
    expect(await resolveNoteImageDirectory(note, name)).toMatchObject({ ok: false, errorCode: 'missingDirectory' })
  })
  it('ignores traversal and arbitrary preferred directories', async() => {
    await mkdir(path.join(fixture, 'images'))
    expect(await resolveNoteImageDirectory(note, '../images')).toMatchObject({ ok: false, errorCode: 'missingDirectory' })
  })
})

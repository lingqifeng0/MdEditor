import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isLocalAttachmentHref } from 'common/localAttachment'
import { resolveLocalAttachment } from 'main_renderer/filesystem/localAttachment'

describe('local attachment locations', () => {
  let directory: string
  let note: string
  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-attachment-'))
    note = path.join(directory, '50%笔记.md')
    fs.mkdirSync(path.join(directory, 'assets'))
    fs.writeFileSync(path.join(directory, 'assets', 'C#.epro'), '')
  })
  afterAll(() => {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('marktext-attachment-')) throw new Error('Unexpected test directory')
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('resolves Chinese names and encoded spaces relative to the note', () => {
    expect(resolveLocalAttachment('assets/%E5%8F%82%E8%80%83%20%E5%B7%A5%E7%A8%8B.epro', note)).toBe(path.join(directory, 'assets', '参考 工程.epro'))
  })

  it('handles fragments while preserving hashes in existing filenames', () => {
    expect(resolveLocalAttachment('assets/diagram.png#view', note)).toBe(path.join(directory, 'assets', 'diagram.png'))
    expect(resolveLocalAttachment('assets/C#.epro', note)).toBe(path.join(directory, 'assets', 'C#.epro'))
    expect(resolveLocalAttachment('assets/C%23.epro', note)).toBe(path.join(directory, 'assets', 'C#.epro'))
  })

  it('accepts absolute paths and file URLs, including a note that has not been saved', () => {
    const filename = path.join(directory, 'assets', '参考 工程.epro')
    expect(resolveLocalAttachment(filename, '')).toBe(filename)
    expect(resolveLocalAttachment(pathToFileURL(filename).href + '#view', '')).toBe(filename)
  })

  it('does not guess a base directory for unsaved notes', () => {
    expect(resolveLocalAttachment('assets/project.epro', '')).toBeNull()
  })

  it('keeps web links, protocols and in-document anchors out of the file menu', () => {
    for (const href of ['', '#section', 'https://example.com/a.epro', 'mailto:a@example.com', 'data:text/plain,a', 'javascript:alert(1)', 'file://%', 'bad\u0000.epro']) {
      expect(resolveLocalAttachment(href, note)).toBeNull()
    }
    expect(isLocalAttachmentHref('https://example.com')).toBe(false)
    expect(isLocalAttachmentHref('assets/project.epro')).toBe(true)
    expect(isLocalAttachmentHref('C:\\资料\\project.epro')).toBe(true)
    expect(isLocalAttachmentHref('\\\\server\\share\\project.epro')).toBe(true)
  })
})

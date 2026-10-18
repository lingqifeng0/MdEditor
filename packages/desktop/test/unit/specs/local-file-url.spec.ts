import { describe, expect, it } from 'vitest'
import { localPathToFileUrl, resolveHtmlImageSource } from '@/util/localFileUrl'

describe('HTML layout local image preview', () => {
  it('uses a server host for an UNC document directory', () => {
    const resolved = new URL(resolveHtmlImageSource('images/图片 空格.png', '\\\\server\\共享\\笔记'))
    expect(resolved.protocol).toBe('file:')
    expect(resolved.hostname).toBe('server')
    expect(decodeURIComponent(resolved.pathname)).toBe('/共享/笔记/images/图片 空格.png')
  })

  it('resolves backslashes and parent directories on a Windows drive', () => {
    const resolved = new URL(resolveHtmlImageSource('..\\图片\\A.png', 'C:\\课程\\笔记'))
    expect(resolved.href).toBe('file:///C:/%E8%AF%BE%E7%A8%8B/%E5%9B%BE%E7%89%87/A.png')
  })

  it('escapes literal percent and hash characters in the document directory', () => {
    const resolved = new URL(resolveHtmlImageSource('images/a%20b%23c.png', 'C:\\课程 100%#\\笔记'))
    expect(decodeURIComponent(resolved.pathname)).toBe('/C:/课程 100%#/笔记/images/a b#c.png')
    expect(resolved.hash).toBe('')
    expect(resolved.search).toBe('')
  })

  it.each([
    ['C:\\图片\\中文 空格.png', 'file:///C:/%E5%9B%BE%E7%89%87/%E4%B8%AD%E6%96%87%20%E7%A9%BA%E6%A0%BC.png'],
    ['\\\\server\\share\\A.png', 'file://server/share/A.png'],
    ['/notes/A.png', 'file:///notes/A.png']
  ])('previews an absolute path without needing a saved document: %s', (src, expected) => {
    expect(resolveHtmlImageSource(src, '')).toBe(expected)
  })

  it.each(['https://example.com/a.png', 'data:image/png;base64,AAAA', 'blob:https://example.com/id', 'file://server/share/a.png'])('keeps an existing image URL: %s', src => {
    expect(resolveHtmlImageSource(src, 'C:\\notes')).toBe(src)
  })

  it('leaves an unsaved relative image unchanged', () => {
    expect(resolveHtmlImageSource('images/a.png', '')).toBe('images/a.png')
  })

  it('treats a directory name containing a percent escape as a literal path', () => {
    expect(localPathToFileUrl('C:\\literal%20\\note')).toBe('file:///C:/literal%2520/note')
  })
})

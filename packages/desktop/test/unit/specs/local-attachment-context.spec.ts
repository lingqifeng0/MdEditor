import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachLocalAttachmentContextMenu } from '@/util/localAttachmentContextMenu'

const mocks = vi.hoisted(() => ({ popup: vi.fn(), notify: vi.fn(), invoke: vi.fn() }))
vi.mock('@/contextMenu/popupMenu', () => ({ popupContextMenu: mocks.popup }))
vi.mock('@/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/services/notification', () => ({ default: { notify: mocks.notify } }))
afterEach(() => { document.body.replaceChildren(); vi.clearAllMocks() })

describe('attachment context-menu binding', () => {
  it('recognizes nested text in Muya link spans and keeps the note path from menu-open time', async() => {
    const editor = document.createElement('div')
    editor.innerHTML = '<span class="mu-link"><strong>工程</strong></span>'
    document.body.append(editor)
    const link = editor.firstElementChild as HTMLElement & { href: string }
    link.href = 'assets/%E5%B7%A5%E7%A8%8B.epro'
    let note = 'E:/资料/项目.md'
    const detach = attachLocalAttachmentContextMenu(editor, () => note)
    mocks.invoke.mockResolvedValue({ ok: true })
    Object.defineProperty(window, 'electron', { configurable: true, value: { ipcRenderer: { invoke: mocks.invoke } } })
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 15, clientY: 25 })
    link.firstElementChild?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(mocks.popup).toHaveBeenCalledOnce()
    expect(mocks.popup.mock.calls[0][1]).toEqual({ x: 15, y: 25 })
    note = 'E:/别处/项目.md'
    await mocks.popup.mock.calls[0][0][0].click()
    expect(mocks.invoke).toHaveBeenCalledWith('mt::shell::reveal-link', link.href, 'E:/资料/项目.md')
    detach()
    link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    expect(mocks.popup).toHaveBeenCalledOnce()
  })

  it('uses raw relative hrefs on HTML anchors instead of browser-resolved application URLs', () => {
    const editor = document.createElement('div')
    editor.innerHTML = '<a href="assets/project.epro">工程</a>'
    const detach = attachLocalAttachmentContextMenu(editor, () => 'E:/笔记/项目.md')
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    editor.firstElementChild?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(mocks.popup).toHaveBeenCalledOnce()
    detach()
  })

  it('leaves web links, anchors and ordinary text to the original context menu', () => {
    const editor = document.createElement('div')
    editor.innerHTML = '<a href="https://example.com">网页</a><a href="#section">章节</a><p>正文</p>'
    const detach = attachLocalAttachmentContextMenu(editor, () => '')
    for (const child of editor.children) {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      child.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(mocks.popup).not.toHaveBeenCalled()
    detach()
  })
})

import { isLocalAttachmentHref } from 'common/localAttachment'
import { popupContextMenu } from '@/contextMenu/popupMenu'
import { t } from '@/i18n'
import notice from '@/services/notification'

export const attachLocalAttachmentContextMenu = (element: HTMLElement, getDocumentPath: () => string): (() => void) => {
  const handler = (event: MouseEvent): void => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href], .mu-link') : null
    if (!anchor || !element.contains(anchor)) return
    // Muya renders labeled Markdown links as spans carrying an href property.
    const property = (anchor as Element & { href?: unknown }).href
    const href = anchor.getAttribute('href') ?? (typeof property === 'string' ? property : '')
    if (!isLocalAttachmentHref(href)) return
    const documentPath = getDocumentPath()
    event.preventDefault()
    event.stopPropagation()
    popupContextMenu([{
      id: 'reveal-local-attachment',
      label: t('localAttachment.openFolder'),
      click: async() => {
        const result = await window.electron.ipcRenderer.invoke('mt::shell::reveal-link', href, documentPath)
        if (!result.ok) notice.notify({ title: t('localAttachment.openFolder'), type: 'warning', message: result.error ?? t('localAttachment.unavailable') })
      }
    }], { x: event.clientX, y: event.clientY })
  }
  element.addEventListener('contextmenu', handler, true)
  return () => element.removeEventListener('contextmenu', handler, true)
}

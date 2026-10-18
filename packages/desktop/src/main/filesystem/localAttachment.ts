import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isLocalAttachmentHref } from 'common/localAttachment'
import { resolveLocalLinkTarget } from './index'

export const resolveLocalAttachment = (href: string, documentPath: string): string | null => {
  if (!isLocalAttachmentHref(href)) return null
  const target = href.trim().replace(/^<(.+)>$/, '$1')
  try {
    if (/^file:/i.test(target)) return fileURLToPath(target)
    // An untitled note has no directory; never fall back to the application's cwd.
    if (!path.isAbsolute(target) && (!documentPath || !path.isAbsolute(documentPath))) return null
    const resolved = resolveLocalLinkTarget(target, documentPath ? path.dirname(documentPath) : '').pathname
    return path.isAbsolute(resolved) ? resolved : null
  } catch {
    return null
  }
}

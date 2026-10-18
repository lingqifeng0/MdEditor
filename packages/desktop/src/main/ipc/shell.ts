import { ipcMain, shell, clipboard, nativeImage } from 'electron'
import log from 'electron-log'
import * as plist from 'plist'
import { stat } from 'node:fs/promises'
import { resolveLocalAttachment } from '../filesystem/localAttachment'
import { t } from '../i18n'

export const registerShellHandlers = (): void => {
  ipcMain.handle('mt::shell::reveal-link', async(_event, href: string, documentPath: string) => {
    const pathname = typeof href === 'string' && typeof documentPath === 'string' ? resolveLocalAttachment(href, documentPath) : null
    if (!pathname) return { ok: false, error: t('localAttachment.unavailable') }
    try {
      await stat(pathname)
      shell.showItemInFolder(pathname)
      return { ok: true }
    } catch {
      return { ok: false, error: t('localAttachment.missing') }
    }
  })
  ipcMain.handle('mt::clipboard::read-image', (): string | null => {
    try {
      const image = clipboard.readImage()
      return image.isEmpty() ? null : image.toDataURL()
    } catch {
      return null
    }
  })
  ipcMain.handle('mt::shell::open-external', async(_e, url: string) => {
    try {
      await shell.openExternal(url)
      return true
    } catch (err) {
      log.error('shell.openExternal failed:', err)
      return false
    }
  })
  ipcMain.on('mt::shell::open-external', (_e, url: string) => {
    shell.openExternal(url).catch((err) => log.error('shell.openExternal failed:', err))
  })
  ipcMain.on('mt::shell::show-item', (_e, fullPath: string) => {
    try {
      shell.showItemInFolder(fullPath)
    } catch (err) {
      log.error('shell.showItemInFolder failed:', err)
    }
  })
  ipcMain.handle('mt::shell::open-path', async(_e, fullPath: string) => {
    try {
      return await shell.openPath(fullPath)
    } catch (err) {
      log.error('shell.openPath failed:', err)
      return String(err instanceof Error ? err.message : err)
    }
  })

  ipcMain.on('mt::clipboard::write-text', (_e, text: string) => {
    try {
      clipboard.writeText(text)
    } catch (err) {
      log.error('clipboard.writeText failed:', err)
    }
  })
  ipcMain.handle('mt::clipboard::write-image', (_e, png: Uint8Array) => {
    try {
      const image = nativeImage.createFromBuffer(Buffer.from(png))
      if (image.isEmpty()) return false
      clipboard.writeImage(image)
      return true
    } catch (err) {
      log.error('clipboard.writeImage failed:', err)
      return false
    }
  })

  ipcMain.handle('mt::clipboard::read-text', () => {
    try {
      return clipboard.readText()
    } catch {
      return ''
    }
  })

  ipcMain.handle('mt::clipboard::guess-file-path', () => {
    try {
      if (process.platform === 'darwin') {
        if (clipboard.has('NSFilenamesPboardType')) {
          const parsed = plist.parse(clipboard.read('NSFilenamesPboardType'))
          return Array.isArray(parsed) && parsed.length ? parsed[0] : ''
        }
        return ''
      }
      if (process.platform === 'win32') {
        // `FileNameW` is a UTF-16LE, NUL-separated list of file paths.
        // `clipboard.read(format)` decodes the raw bytes as UTF-8, which garbles
        // non-ASCII (e.g. Chinese) characters; read the Buffer and decode it as
        // UTF-16LE instead, then take the first non-empty entry.
        const buffer = clipboard.readBuffer('FileNameW')
        if (buffer.length > 0) {
          return buffer.toString('utf16le').split('\u0000').find(p => p.length > 0) ?? ''
        }
        return ''
      }
      return ''
    } catch (err) {
      log.error('clipboard.guess-file-path failed:', err)
      return ''
    }
  })
}

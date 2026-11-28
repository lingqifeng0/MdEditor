import { BrowserWindow, ipcMain, screen } from 'electron'
import type { Rectangle, WebContents } from 'electron'
import log from 'electron-log'
import type { TabWindowTransfer } from '@shared/types/tabWindow'
import type EditorWindow from '../windows/editor'
import { WindowType } from '../windows/base'
import type WindowManager from './windowManager'
import { transferTabImages } from '../ipc/image'

const TRANSFER_TIMEOUT_MS = 20000

interface PendingTransfer {
  sender: WebContents
  tabId: string
  ready: () => void
  finish: (accept: boolean) => boolean
}

const newWindowBounds = (source: BrowserWindow): Rectangle => {
  const { workArea } = screen.getDisplayMatching(source.getBounds())
  const previous = source.getNormalBounds()
  const width = Math.min(previous.width, workArea.width - 32)
  const height = Math.min(previous.height, workArea.height - 32)
  return {
    x: Math.max(workArea.x, Math.min(previous.x + 28, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(previous.y + 28, workArea.y + workArea.height - height)),
    width,
    height
  }
}

export const registerTabWindowTransfers = (
  manager: WindowManager,
  createWindow: (tab: TabWindowTransfer, bounds: Rectangle) => EditorWindow
): void => {
  const pending = new Map<number, PendingTransfer>()

  ipcMain.handle('mt::tab-window::prepare', (event, tab: TabWindowTransfer) => {
    const sender = event.sender
    const source = BrowserWindow.fromWebContents(sender)
    if (!source || manager.get(source.id)?.type !== WindowType.EDITOR ||
        event.senderFrame !== sender.mainFrame || source.isDestroyed() ||
        typeof tab?.file?.id !== 'string' || typeof tab.file.markdown !== 'string' ||
        typeof tab.file.pathname !== 'string' || !Array.isArray(tab.deletedImages)) {
      return null
    }

    return new Promise<number | null>((resolve) => {
      const target = createWindow(tab, newWindowBounds(source))
      const win = target.browserWindow
      if (!win) {
        resolve(null)
        return
      }
      const targetId = win.id
      const contents = win.webContents
      let ready = false
      const cancel = (): void => { finish(false) }
      const finish = (accept: boolean): boolean => {
        if (!pending.delete(targetId)) return false
        clearTimeout(timeout)
        sender.removeListener('destroyed', cancel)
        sender.removeListener('render-process-gone', cancel)
        win.removeListener('closed', cancel)
        contents.removeListener('render-process-gone', cancel)
        contents.removeListener('did-fail-load', cancel)
        resolve(null)
        if (win.isDestroyed()) return false
        if (ready && accept) {
          if (tab.file.pathname) target.addToOpenedFiles(tab.file.pathname)
          transferTabImages(sender, contents, tab.file.id, tab.deletedImages.map(entry => entry.token))
          if (tab.deletedImages.length) contents.send('mt::tab-window::image-history', tab.deletedImages)
          target.bringToFront()
          return true
        }
        manager.forceCloseById(targetId)
        return false
      }
      const timeout = setTimeout(cancel, TRANSFER_TIMEOUT_MS)
      pending.set(targetId, {
        sender,
        tabId: tab.file.id,
        ready: () => {
          ready = true
          resolve(targetId)
        },
        finish
      })
      sender.once('destroyed', cancel)
      sender.once('render-process-gone', cancel)
      win.once('closed', cancel)
      contents.once('render-process-gone', cancel)
      contents.once('did-fail-load', cancel)
    })
  })

  ipcMain.on('mt::window-initialized', (event, tabId?: string) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target || !tabId || event.senderFrame !== event.sender.mainFrame) return
    const transfer = pending.get(target.id)
    if (transfer?.tabId === tabId) transfer.ready()
  })

  ipcMain.on('mt::tab-window::finish', (event, targetId: number, accept: boolean) => {
    const transfer = pending.get(targetId)
    let moved = false
    if (transfer && transfer.sender === event.sender && event.senderFrame === event.sender.mainFrame) {
      try {
        moved = transfer.finish(accept === true)
      } catch (error) {
        log.error('Unable to finish moving an editor tab:', error)
        manager.forceCloseById(targetId)
      }
    }
    event.returnValue = moved
  })
}

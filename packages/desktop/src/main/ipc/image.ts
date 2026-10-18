import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import log from 'electron-log'
import type { WebContents } from 'electron'
import { localImagePathCandidates } from 'common/imageFilePath'
import { resolveNoteImageDirectory } from 'common/imageDirectory'
import { LocalImageWatcher } from '../filesystem/imageWatcher'
import { prepareNoteImageDirectory } from '../filesystem/noteImageDirectory'
import { ImageTrashLedger } from '../filesystem/imageTrash'
import { imageDrafts as drafts } from '../filesystem/imageDraftState'
import { loadMarkdownFile } from '../filesystem/markdown'
import type { ImageEditorResult, ImageRevealResult, ImageDraftReference, StoreDraftImageRequest, ReleaseDraftImagesRequest } from '@shared/types/ipc'
import { t } from '../i18n'

const pendingImageEditorRefresh = new WeakMap<BrowserWindow, () => void>()

const validEditorPath = (editorPath: string): boolean => typeof editorPath === 'string' &&
  !!editorPath.trim() && !editorPath.includes('\0') && path.isAbsolute(editorPath) &&
  (process.platform !== 'win32' || path.extname(editorPath).toLowerCase() === '.exe')

const invalidateImages = (sender: WebContents): void => {
  if (!sender.isDestroyed()) sender.send('mt::invalidate-image-cache')
}

const refreshOnEditorReturn = (sender: WebContents): (() => void) => {
  if (sender.isDestroyed()) return () => {}
  const owner = BrowserWindow.fromWebContents(sender)
  if (!owner || owner.isDestroyed()) return () => {}
  pendingImageEditorRefresh.get(owner)?.()
  const cleanup = (): void => {
    owner.removeListener('focus', onFocus)
    owner.removeListener('closed', cleanup)
    if (pendingImageEditorRefresh.get(owner) === cleanup) pendingImageEditorRefresh.delete(owner)
  }
  const onFocus = (): void => {
    cleanup()
    invalidateImages(sender)
  }
  // Single-instance editors may exit their launcher before the user saves; returning focus remains useful.
  owner.once('focus', onFocus)
  owner.once('closed', cleanup)
  pendingImageEditorRefresh.set(owner, cleanup)
  return cleanup
}

const openImageInEditor = async(sender: WebContents, src: string, documentPath: string, editorPath: string): Promise<ImageEditorResult> => {
  if (typeof editorPath !== 'string' || !editorPath.trim()) return { ok: false, errorCode: 'notConfigured' }
  if (!validEditorPath(editorPath)) return { ok: false, errorCode: 'invalidProgram' }
  try {
    if (!(await stat(editorPath)).isFile()) return { ok: false, errorCode: 'invalidProgram' }
    await access(editorPath, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
  } catch {
    return { ok: false, errorCode: 'programMissing' }
  }
  const candidates = localImagePathCandidates(src, typeof documentPath === 'string' ? documentPath : '')
  if (!candidates.length) return { ok: false, errorCode: 'nonLocalImage' }
  let imagePath: string | undefined
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) {
        imagePath = candidate
        break
      }
    } catch {}
  }
  if (!imagePath) return { ok: false, errorCode: 'imageMissing' }
  return new Promise(resolve => {
    try {
      const child = spawn(editorPath, [imagePath], { shell: false, stdio: 'ignore', detached: true, windowsHide: true })
      let cleanup = (): void => {}
      child.once('error', () => {
        cleanup()
        resolve({ ok: false, errorCode: 'launchFailed' })
      })
      child.once('spawn', () => {
        cleanup = refreshOnEditorReturn(sender)
        child.unref()
        resolve({ ok: true, processId: child.pid })
      })
      child.once('exit', () => invalidateImages(sender))
    } catch {
      resolve({ ok: false, errorCode: 'launchFailed' })
    }
  })
}

export const registerImageHandlers = (): void => {
  const watchers = new Map<WebContents, LocalImageWatcher>()
  const trashLedgers = new WeakMap<WebContents, ImageTrashLedger>()
  const preparing = new WeakSet<WebContents>()
  ipcMain.handle('mt::image::store-draft', (event, request: StoreDraftImageRequest) => drafts.store(`${event.sender.id}:${request.noteId}`, request))
  ipcMain.handle('mt::image::commit-draft', (event, note: ImageDraftReference) => drafts.commit(note, `${event.sender.id}:${note.id}`))
  ipcMain.handle('mt::image::retain-draft-links', (event, note: ImageDraftReference) => drafts.retainLinks(`${event.sender.id}:${note.id}`, note))
  ipcMain.handle('mt::image::release-drafts', (event, request: ReleaseDraftImagesRequest) => drafts.release(request.noteIds.map(id => `${event.sender.id}:${id}`), request.retained, request.scope))
  ipcMain.handle('mt::image::saved-markdown', async(_event, pathname: string) => (await loadMarkdownFile(pathname, 'lf')).markdown)
  ipcMain.handle('mt::image::prepare-directory', async(event, request) => {
    if (preparing.has(event.sender)) return { ok: false, error: '当前目录操作尚未完成。' }
    preparing.add(event.sender)
    try {
      const result = await prepareNoteImageDirectory(request)
      const owner = BrowserWindow.fromWebContents(event.sender)
      if (result.ok && owner) {
        ipcMain.emit(request.pathname ? 'window-change-file-path' : 'window-add-file-path', owner.id, result.pathname, request.pathname)
      }
      return result
    } finally { preparing.delete(event.sender) }
  })
  const ledgerFor = (sender: WebContents): ImageTrashLedger => {
    let ledger = trashLedgers.get(sender)
    if (!ledger) { ledger = new ImageTrashLedger(pathname => shell.trashItem(pathname)); trashLedgers.set(sender, ledger) }
    return ledger
  }
  ipcMain.handle('mt::image::trash', async(event, src: string, documentPath: string) => {
    const result = await ledgerFor(event.sender).remove(src, documentPath)
    if (result.ok) invalidateImages(event.sender)
    return result
  })
  ipcMain.handle('mt::image::restore-trash', async(event, token: string, restore: boolean) => {
    const result = await ledgerFor(event.sender).reconcile(token, restore)
    if (result.ok) invalidateImages(event.sender)
    return result
  })
  ipcMain.handle('mt::image::resolve-directory', (_event, documentPath: string, preferredName: string) =>
    resolveNoteImageDirectory(documentPath, preferredName)
  )
  ipcMain.handle('mt::image::watch', async(event, sources: string[], documentPath: string): Promise<void> => {
    if (!Array.isArray(sources) || typeof documentPath !== 'string' || event.sender.isDestroyed()) return
    let watcher = watchers.get(event.sender)
    if (!watcher) {
      watcher = new LocalImageWatcher(() => invalidateImages(event.sender))
      watchers.set(event.sender, watcher)
      event.sender.once('destroyed', () => {
        watcher?.close().catch(error => log.warn('Unable to close image watcher:', error))
        watchers.delete(event.sender)
      })
    }
    await watcher.update(sources.filter(src => typeof src === 'string'), documentPath)
  })
  ipcMain.handle('mt::image::choose-editor', async(event, currentPath: string): Promise<string | null> => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner || owner.isDestroyed()) return null
    try {
      const options = {
        title: t('preferences.image.externalEditor.choose'),
        properties: ['openFile'] as Array<'openFile'>,
        filters: process.platform === 'win32' ? [{ name: 'Executable', extensions: ['exe'] }] : undefined,
        defaultPath: validEditorPath(currentPath) ? currentPath : undefined
      }
      const result = await dialog.showOpenDialog(owner, options)
      const selected = result.filePaths[0]
      return !result.canceled && selected && validEditorPath(selected) ? selected : null
    } catch {
      return null
    }
  })
  ipcMain.handle('mt::image::open-in-editor', (event, src: string, documentPath: string, editorPath: string): Promise<ImageEditorResult> =>
    openImageInEditor(event.sender, src, documentPath, editorPath)
  )
  ipcMain.handle('mt::clipboard::copy-image-at', (event, x: number, y: number): boolean => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return false
    try {
      event.sender.copyImageAt(Math.round(x), Math.round(y))
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('mt::image::reveal', async(_event, src: string, documentPath: string): Promise<ImageRevealResult> => {
    const candidates = localImagePathCandidates(src, documentPath)
    if (!candidates.length) {
      return { ok: false, error: '此图片没有可定位的本地文件，或文档尚未保存。' }
    }
    for (const candidate of candidates) {
      try {
        if (!(await stat(candidate)).isFile()) continue
        shell.showItemInFolder(candidate)
        return { ok: true }
      } catch {}
    }
    return { ok: false, error: '图片文件不存在或无法访问。' }
  })
}

import { BrowserWindow, Menu, ipcMain } from 'electron'
import { COMMANDS } from '../../commands'
import type { CommandManager } from '../../commands'
import { isOsx } from '../../config'
import { APP_NAME } from 'common/appIdentity'

ipcMain.on('mt::NEED_UPDATE', (e) => {
  checkUpdates(BrowserWindow.fromWebContents(e.sender))
})

ipcMain.on('mt::check-for-update', (e) => {
  const senderWin = BrowserWindow.fromWebContents(e.sender)
  checkUpdates(senderWin)
})

// --------------------------------------------------------

export const userSetting = (): void => {
  ipcMain.emit('app-create-settings-window')
}

export const checkUpdates = (browserWindow: BrowserWindow | null): void => {
  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.webContents.send(
      'mt::UPDATE_NOT_AVAILABLE',
      `${APP_NAME} 使用安装包手动更新。请先保存文档并退出，再运行新版安装包。`
    )
  }
}

export const osxHide = (): void => {
  if (isOsx) {
    Menu.sendActionToFirstResponder('hide:')
  }
}

export const osxHideAll = (): void => {
  if (isOsx) {
    Menu.sendActionToFirstResponder('hideOtherApplications:')
  }
}

export const osxShowAll = (): void => {
  if (isOsx) {
    Menu.sendActionToFirstResponder('unhideAllApplications:')
  }
}

// --- Commands -------------------------------------------------------------

export const loadMarktextCommands = (commandManager: CommandManager): void => {
  commandManager.add(COMMANDS.MT_HIDE, osxHide)
  commandManager.add(COMMANDS.MT_HIDE_OTHERS, osxHideAll)
}

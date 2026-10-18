import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, send, window, updater } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const send = vi.fn()
  const window = { isDestroyed: vi.fn(() => false), webContents: { send } }
  const updater = { on: vi.fn(), checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn() }
  return { handlers, send, window, updater }
})

vi.mock('electron-updater', () => ({ autoUpdater: updater }))
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => window },
  Menu: { sendActionToFirstResponder: vi.fn() },
  ipcMain: { on: (channel: string, listener: (...args: unknown[]) => void) => handlers.set(channel, listener), emit: vi.fn() }
}))
vi.mock('main_renderer/commands', () => ({ COMMANDS: { MT_HIDE: 'hide', MT_HIDE_OTHERS: 'hide-others' } }))
vi.mock('main_renderer/config', () => ({ isOsx: false }))

import { checkUpdates } from 'main_renderer/menu/actions/marktext'

describe('custom edition update policy', () => {
  beforeEach(() => {
    send.mockClear()
    updater.checkForUpdates.mockClear()
    updater.downloadUpdate.mockClear()
    updater.quitAndInstall.mockClear()
  })

  it.each(['mt::check-for-update', 'mt::NEED_UPDATE'])('blocks the legacy %s IPC download path', channel => {
    handlers.get(channel)?.({ sender: {} }, { needUpdate: true })
    expect(send).toHaveBeenCalledWith('mt::UPDATE_NOT_AVAILABLE', expect.stringContaining('安装包手动更新'))
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(updater.on).not.toHaveBeenCalled()
  })

  it('handles a missing window without starting an updater', () => {
    checkUpdates(null)
    expect(send).not.toHaveBeenCalled()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })
})

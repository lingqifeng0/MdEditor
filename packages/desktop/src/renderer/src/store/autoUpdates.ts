import { defineStore } from 'pinia'
import notice from '../services/notification'

export const useAutoUpdatesStore = defineStore('autoUpdates', () => {
  function LISTEN_FOR_UPDATE(): void {
    window.electron.ipcRenderer.on('mt::UPDATE_NOT_AVAILABLE', (_e, message) => {
      notice.notify({
        title: '定制版手动更新',
        type: 'primary',
        message: String(message ?? '')
      })
    })
  }

  return { LISTEN_FOR_UPDATE }
})

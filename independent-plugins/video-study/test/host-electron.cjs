const { EventEmitter } = require('node:events')
const { fork } = require('node:child_process')
const path = require('node:path')

function createElectron() {
  const notices = []
  const dialogs = []
  const logs = []
  const app = new EventEmitter()
  app.isPackaged = true
  app.getVersion = () => '0.31.0-toolbar.v8.31'
  app.getAppPath = () => process.cwd()
  app.quit = () => {}
  const ipcMain = new EventEmitter()
  ipcMain.handlers = new Map()
  ipcMain.handle = (name, callback) => ipcMain.handlers.set(name, callback)
  class Window extends EventEmitter {
    constructor() {
      super()
      this.id = 7
      this.webContents = {
        mainFrame:{}, send:(channel, value) => {
          if (channel !== 'mt::plugins::request') return
          if (value.method === 'ui.notice') notices.push(value.args[0])
          const event = { sender:this.webContents, senderFrame:this.webContents.mainFrame }
          queueMicrotask(() => ipcMain.emit('mt::plugins::response', event, { id:value.id, value:null }))
        }
      }
    }
    isDestroyed() { return false }
  }
  const window = new Window()
  const BrowserWindow = {
    getAllWindows:() => [window], getFocusedWindow:() => window,
    fromId:id => id === window.id ? window : null,
    fromWebContents:sender => sender === window.webContents ? window : null
  }
  const nativeTheme = new EventEmitter()
  nativeTheme.shouldUseDarkColors = true
  const children = new Set()
  return {
    app, ipcMain, BrowserWindow, nativeTheme, window, notices, dialogs, logs, children,
    event:{ sender:window.webContents, senderFrame:window.webContents.mainFrame },
    protocol:{ registerSchemesAsPrivileged() {}, handle() {} },
    clipboard:{}, shell:{},
    dialog:{
      async showMessageBox(_window, options) { dialogs.push(options); return { response:1 } }
    },
    utilityProcess:{
      fork(filename) {
        const child = fork(path.join(__dirname, 'host-worker-bootstrap.cjs'), [filename], {
          execPath:process.execPath, windowsHide:true, stdio:['ignore', 'ignore', 'ignore', 'ipc']
        })
        children.add(child)
        child.once('exit', () => children.delete(child))
        child.postMessage = message => { if (child.connected) child.send(message) }
        return child
      }
    },
    async control(action, payload) {
      return await ipcMain.handlers.get('mt::plugins::control')(this.event, action, payload)
    }
  }
}
module.exports = { createElectron }

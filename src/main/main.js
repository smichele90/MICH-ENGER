const { app, BrowserWindow, ipcMain, nativeTheme, protocol } = require('electron')
const path = require('path')
const { initDatabase } = require('./database')
const { registerIpcHandlers } = require('./ipc-handlers')
const { WhatsAppManager } = require('./whatsapp')

let mainWindow = null
let waManager = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'MICH-ENGER',
    icon: path.join(__dirname, '../../assets/icon.png'),
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false
    }
  })

  // Carica il renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Apri DevTools in sviluppo
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

// Window controls IPC
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window:close', () => mainWindow?.close())
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized())

// Registra il protocollo come privilegiato per evitare blocchi di sicurezza nel renderer
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { bypassCSP: true, supportFetchAPI: true, secure: true, standard: true } }
])

app.whenReady().then(() => {
  // Protocollo per file locali (media)
  protocol.registerFileProtocol('media', (request, callback) => {
    let url = request.url.replace('media://', '')
    url = decodeURIComponent(url)
    // Se il percorso non è assoluto (es. inizia con slash ma senza drive), aggiungilo? 
    // In realtà usiamo percorsi assoluti dal main.
    callback({ path: path.normalize(url) })
  })

  // Inizializza database
  const db = initDatabase()

  // Crea finestra principale
  const window = createWindow()

  // Inizializza WhatsApp Manager
  waManager = new WhatsAppManager(db, window)

  // Registra IPC handlers
  registerIpcHandlers(db, waManager)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

const { app, BrowserWindow, ipcMain, nativeImage, nativeTheme, protocol } = require('electron')
const path = require('path')
const fs = require('fs')

if (app.isPackaged) {
  try { process.chdir(path.dirname(process.execPath)) } catch {}
}

try {
  const logDir = app.getPath('userData')
  fs.mkdirSync(logDir, { recursive: true })
  const logPath = path.join(logDir, 'main.log')
  const logStream = fs.createWriteStream(logPath, { flags: 'w' })
  const ts = () => new Date().toISOString()
  const fmt = (args) => args.map(a => {
    if (a instanceof Error) return a.stack || a.message
    if (typeof a === 'object') { try { return JSON.stringify(a) } catch { return String(a) } }
    return String(a)
  }).join(' ')
  const wrap = (level, orig) => (...args) => {
    try { logStream.write(`[${ts()}] [${level}] ${fmt(args)}\n`) } catch {}
    orig(...args)
  }
  console.log = wrap('log', console.log.bind(console))
  console.error = wrap('error', console.error.bind(console))
  console.warn = wrap('warn', console.warn.bind(console))
  console.info = wrap('info', console.info.bind(console))
  process.on('uncaughtException', (err) => {
    try { logStream.write(`[${ts()}] [uncaughtException] ${err.stack || err.message}\n`) } catch {}
  })
  process.on('unhandledRejection', (reason) => {
    try { logStream.write(`[${ts()}] [unhandledRejection] ${reason instanceof Error ? (reason.stack || reason.message) : String(reason)}\n`) } catch {}
  })
  console.log(`[main] log file: ${logPath}`)
  console.log(`[main] platform: ${process.platform} arch: ${process.arch} electron: ${process.versions.electron}`)
  console.log(`[main] argv: ${process.argv.join(' ')}`)
  console.log(`[main] cwd: ${process.cwd()}`)
  console.log(`[main] resourcesPath: ${process.resourcesPath}`)
  console.log(`[main] USERPROFILE: ${process.env.USERPROFILE}`)
  console.log(`[main] APPDATA: ${process.env.APPDATA}`)
  console.log(`[main] LOCALAPPDATA: ${process.env.LOCALAPPDATA}`)
  console.log(`[main] userData: ${logDir}`)
} catch (e) {
  console.error('[main] failed to setup file logger:', e?.message)
}

const { initDatabase, dedupeContacts, cleanSystemContacts } = require('./database')
const { registerIpcHandlers } = require('./ipc-handlers')
const { WhatsAppManager, resolveBrowserPath } = require('./whatsapp')
const { Scheduler } = require('./scheduler')
const { NotificationManager } = require('./notification-manager')
const { initUpdater } = require('./updater')

try { console.log(`[main] resolved browser: ${resolveBrowserPath() || '(default puppeteer)'}`) } catch {}

let mainWindow = null
let waManager = null
let scheduler = null
let notificationManager = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'MICH-ENGER',
    icon: path.join(__dirname, '../../assets/icona.png'),
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#f3ede2',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // In dev (Vite dev-server su http://) il caricamento di file:/// per media/avatar
      // viene bloccato da webSecurity. In produzione il renderer usa file:// quindi
      // il blocco non si applica e webSecurity può rimanere attivo.
      webSecurity: process.env.NODE_ENV !== 'development'
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

  const sendMaxState = () => {
    try { mainWindow?.webContents.send('window:maxState', mainWindow.isMaximized()) } catch {}
  }
  mainWindow.on('maximize', sendMaxState)
  mainWindow.on('unmaximize', sendMaxState)
  mainWindow.on('resize', sendMaxState)

  return mainWindow
}

// Badge icona taskbar/dock
ipcMain.handle('app:setBadge', (_, count, dataURL) => {
  if (process.platform === 'darwin') {
    if (app.dock) app.dock.setBadge(count > 0 ? (count > 99 ? '99+' : String(count)) : '')
  } else if (process.platform === 'win32') {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (count > 0 && dataURL) {
      mainWindow.setOverlayIcon(nativeImage.createFromDataURL(dataURL), `${count} non letti`)
    } else {
      mainWindow.setOverlayIcon(null, '')
    }
  }
})

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
  { scheme: 'media', privileges: { supportFetchAPI: true, secure: true, standard: true } }
])

app.whenReady().then(() => {
  // Protocollo per file locali (media)
  protocol.registerFileProtocol('media', (request, callback) => {
    let url = request.url.replace('media://', '')
    url = decodeURIComponent(url)
    const resolved = path.resolve(url)
    const userData = app.getPath('userData')
    const allowed = [
      path.resolve(path.join(userData, 'media')),
      path.resolve(path.join(userData, 'avatars')),
    ]
    if (!allowed.some(base => resolved.startsWith(base + path.sep) || resolved === base)) {
      return callback({ error: -10 }) // net::ERR_ACCESS_DENIED
    }
    callback({ path: resolved })
  })

  // Inizializza database
  const db = initDatabase()

  // Pulizia contatti duplicati (legacy da versioni precedenti)
  try {
    const { merged } = dedupeContacts()
    if (merged > 0) console.log(`[DB] Dedupe: uniti ${merged} contatti duplicati`)
  } catch (e) { console.error('[DB] dedupe error:', e) }

  // Pulizia status broadcast e altri contatti di sistema
  try {
    const { removed } = cleanSystemContacts()
    if (removed > 0) console.log(`[DB] Rimossi ${removed} contatti di sistema (status broadcast, ecc.)`)
  } catch (e) { console.error('[DB] clean system contacts error:', e) }

  // Crea finestra principale
  const window = createWindow()

  // Inizializza WhatsApp Manager
  waManager = new WhatsAppManager(db, window)

  // Notification Manager (notifiche desktop)
  notificationManager = new NotificationManager(db, window)

  // Scheduler messaggi programmati
  scheduler = new Scheduler(db, window, (msg) => waManager.sendScheduledTo(msg))
  scheduler.setNotificationManager(notificationManager)
  scheduler.start()

  // Avvia loop notifiche task
  notificationManager.startTaskWatcher()

  // Registra IPC handlers
  registerIpcHandlers(db, waManager, scheduler, notificationManager)

  // Controllo aggiornamenti (solo build pacchettizzata)
  try { initUpdater(window) } catch (e) { console.error('[updater] init error:', e?.message) }

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

app.on('before-quit', () => {
  try { scheduler?.shutdown() } catch {}
  try { notificationManager?.stop() } catch {}
})

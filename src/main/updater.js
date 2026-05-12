const { app, dialog, shell, ipcMain } = require('electron')
const { autoUpdater } = require('electron-updater')
const log = require('electron-log')
const https = require('https')

const GITHUB_OWNER = 'smichele90'
const GITHUB_REPO = 'MICH-ENGER'

log.transports.file.level = 'info'
autoUpdater.logger = log
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

function fetchLatestReleaseTag() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      method: 'GET',
      headers: { 'User-Agent': 'MICH-ENGER-Updater', 'Accept': 'application/vnd.github+json' }
    }, (res) => {
      let body = ''
      res.on('data', (c) => body += c)
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`GitHub API ${res.statusCode}`))
        try {
          const json = JSON.parse(body)
          resolve({ tag: (json.tag_name || '').replace(/^v/, ''), htmlUrl: json.html_url })
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('GitHub API timeout')))
    req.end()
  })
}

function isNewer(remote, current) {
  const a = remote.split('.').map(n => parseInt(n, 10) || 0)
  const b = current.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

async function checkMacManual(mainWindow) {
  try {
    const { tag, htmlUrl } = await fetchLatestReleaseTag()
    if (!tag) return
    const current = app.getVersion()
    if (!isNewer(tag, current)) {
      log.info(`[updater] Mac: already up to date (current ${current}, latest ${tag})`)
      return
    }
    const res = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Aggiornamento disponibile',
      message: `È disponibile la versione ${tag}`,
      detail: `Stai usando la versione ${current}. Su macOS l'aggiornamento automatico non è attivo: apri la pagina della release e scarica il nuovo file .dmg.`,
      buttons: ['Apri pagina release', 'Più tardi'],
      defaultId: 0,
      cancelId: 1
    })
    if (res.response === 0 && htmlUrl) shell.openExternal(htmlUrl)
  } catch (e) {
    log.warn('[updater] Mac manual check failed:', e?.message)
  }
}

function bindAutoUpdaterEvents(mainWindow) {
  autoUpdater.removeAllListeners()

  autoUpdater.on('update-available', async (info) => {
    log.info('[updater] update-available', info?.version)
    const res = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Aggiornamento disponibile',
      message: `È disponibile la versione ${info.version}`,
      detail: `Stai usando la versione ${app.getVersion()}. Vuoi scaricare l'aggiornamento ora?`,
      buttons: ['Scarica', 'Più tardi'],
      defaultId: 0,
      cancelId: 1
    })
    if (res.response === 0) {
      try { autoUpdater.downloadUpdate() } catch (e) { log.error('[updater] downloadUpdate error:', e) }
    }
  })

  autoUpdater.on('update-not-available', (info) => {
    log.info('[updater] update-not-available', info?.version)
  })

  autoUpdater.on('download-progress', (p) => {
    log.info(`[updater] download ${Math.round(p.percent)}% @ ${Math.round((p.bytesPerSecond || 0) / 1024)} KB/s`)
    try { mainWindow?.webContents.send('updater:progress', { percent: p.percent }) } catch {}
  })

  autoUpdater.on('update-downloaded', async (info) => {
    log.info('[updater] update-downloaded', info?.version)
    const res = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Aggiornamento pronto',
      message: `La versione ${info.version} è stata scaricata`,
      detail: "Riavvia l'app per completare l'installazione.",
      buttons: ['Riavvia ora', 'Più tardi'],
      defaultId: 0,
      cancelId: 1
    })
    if (res.response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall())
    }
  })

  autoUpdater.on('error', (err) => {
    log.error('[updater] error:', err?.message || err)
  })
}

function initUpdater(mainWindow) {
  if (!app.isPackaged) {
    log.info('[updater] skipped (not packaged)')
    return
  }

  ipcMain.handle('updater:check', async () => {
    try {
      if (process.platform === 'darwin') {
        await checkMacManual(mainWindow)
        return { ok: true, platform: 'darwin', mode: 'manual' }
      }
      const r = await autoUpdater.checkForUpdates()
      return { ok: true, version: r?.updateInfo?.version || null }
    } catch (e) {
      log.error('[updater] manual check error:', e?.message)
      return { ok: false, error: e?.message }
    }
  })

  setTimeout(() => {
    if (process.platform === 'darwin') {
      checkMacManual(mainWindow)
      return
    }
    bindAutoUpdaterEvents(mainWindow)
    autoUpdater.checkForUpdates().catch((e) => log.error('[updater] initial check error:', e?.message))
  }, 3000)
}

module.exports = { initUpdater }

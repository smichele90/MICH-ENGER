const { Notification } = require('electron')

/**
 * Gestisce le notifiche desktop per task in scadenza.
 * Polling ogni 60s sulla tabella tasks. Per evitare ri-notifiche tra riavvii
 * dell'app, dopo aver notificato si avanza `notify_at` al prossimo periodo
 * (per task ricorrenti) oppure si imposta notify=0 (per task una-tantum).
 */
class NotificationManager {
  constructor(db, mainWindow) {
    this.db = db
    this.mainWindow = mainWindow
    this.intervalId = null
  }

  enabled() {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'notifications_enabled'").get()
    return !row || row.value === 'true'
  }

  notify({ title, body, onClick }) {
    if (!this.enabled()) return
    if (!Notification.isSupported()) return
    try {
      const n = new Notification({ title, body, silent: false })
      if (onClick) n.on('click', onClick)
      n.show()
    } catch (e) {
      console.error('[Notif] error:', e)
    }
  }

  /** Avanza una data ISO al prossimo periodo della ricorrenza */
  advanceNotifyAt(isoDate, recurrence) {
    const d = new Date(isoDate)
    if (Number.isNaN(d.getTime())) return null
    const now = Date.now()
    let safety = 0
    do {
      switch (recurrence) {
        case 'daily':   d.setDate(d.getDate() + 1); break
        case 'weekly':  d.setDate(d.getDate() + 7); break
        case 'monthly': d.setMonth(d.getMonth() + 1); break
        default: return null
      }
      safety++
    } while (d.getTime() <= now && safety < 1000)
    return d.toISOString()
  }

  startTaskWatcher() {
    if (this.intervalId) return
    const tick = () => {
      try {
        const now = new Date().toISOString()
        const due = this.db.prepare(`
          SELECT id, title, description, recurrence_type, notify_at FROM tasks
          WHERE notify = 1 AND notify_at IS NOT NULL AND notify_at <= ?
            AND status NOT IN ('done', 'archived')
        `).all(now)
        for (const t of due) {
          this.notify({
            title: `Task: ${t.title}`,
            body: t.description?.slice(0, 120) || 'È ora di occuparsi di questo task.',
            onClick: () => {
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.show()
                this.mainWindow.focus()
                this.mainWindow.webContents.send('notification:task-click', { taskId: t.id })
              }
            }
          })

          if (t.recurrence_type && t.recurrence_type !== 'once') {
            // Avanza notify_at al prossimo periodo (persistito nel DB)
            const nextAt = this.advanceNotifyAt(t.notify_at, t.recurrence_type)
            if (nextAt) {
              this.db.prepare('UPDATE tasks SET notify_at = ? WHERE id = ?').run(nextAt, t.id)
            } else {
              this.db.prepare('UPDATE tasks SET notify = 0 WHERE id = ?').run(t.id)
            }
          } else {
            // One-shot: spegni la notifica
            this.db.prepare('UPDATE tasks SET notify = 0 WHERE id = ?').run(t.id)
          }
        }
      } catch (e) {
        console.error('[Notif] task watcher error:', e)
      }
    }
    tick()
    this.intervalId = setInterval(tick, 60_000)
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }
}

module.exports = { NotificationManager }

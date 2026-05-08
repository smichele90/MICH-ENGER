const schedule = require('node-schedule')
const fs = require('fs')
const path = require('path')

/**
 * Scheduler dei messaggi programmati.
 * Carica i job dal DB all'avvio, registra i job in node-schedule,
 * e gestisce ricorrenze (once/daily/weekly/monthly/custom-cron).
 *
 * L'invio effettivo è delegato al WhatsAppManager via callback `sendFn`.
 */
class Scheduler {
  constructor(db, mainWindow, sendFn) {
    this.db = db
    this.mainWindow = mainWindow
    this.sendFn = sendFn // async (msg) => ok
    this.jobs = new Map() // id -> node-schedule.Job
    this.notificationManager = null
  }

  setNotificationManager(nm) { this.notificationManager = nm }

  start() {
    const rows = this.db.prepare('SELECT * FROM scheduled_messages WHERE is_active = 1').all()
    for (const msg of rows) {
      // Riallinea next_send_at se è nel passato per ricorrenze
      if (msg.recurrence_type !== 'once') {
        const next = this.computeNext(msg)
        if (next) {
          this.db.prepare('UPDATE scheduled_messages SET next_send_at = ? WHERE id = ?').run(next.toISOString(), msg.id)
          msg.next_send_at = next.toISOString()
        }
      }
      this.scheduleOne(msg)
    }
  }

  scheduleOne(msg) {
    this.cancelOne(msg.id)
    const when = msg.next_send_at || msg.scheduled_at
    if (!when) return
    const date = new Date(when)
    if (Number.isNaN(date.getTime())) return

    // Se è già passato (job una tantum), non schedulare
    if (date <= new Date() && msg.recurrence_type === 'once') {
      this.db.prepare('UPDATE scheduled_messages SET is_active = 0 WHERE id = ?').run(msg.id)
      return
    }

    const job = schedule.scheduleJob(date, async () => {
      await this.fire(msg.id)
    })
    if (job) this.jobs.set(msg.id, job)
  }

  cancelOne(id) {
    const j = this.jobs.get(id)
    if (j) { try { j.cancel() } catch {} this.jobs.delete(id) }
  }

  async fire(id) {
    const msg = this.db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(id)
    if (!msg || !msg.is_active) return

    const ok = await this.sendFn(msg).catch(err => {
      console.error(`[Scheduler] send error for ${id}:`, err)
      return false
    })

    this.db.prepare("UPDATE scheduled_messages SET last_sent_at = datetime('now') WHERE id = ?").run(id)

    if (this.notificationManager && ok) {
      this.notificationManager.notify({
        title: 'Messaggio inviato',
        body: `Inviato a ${msg.target_name || 'destinatario'}`,
      })
    }

    if (msg.recurrence_type === 'once') {
      this.db.prepare('UPDATE scheduled_messages SET is_active = 0 WHERE id = ?').run(id)
      this.jobs.delete(id)
      if (ok && msg.media_path) {
        try { fs.unlinkSync(path.resolve(msg.media_path)) } catch {}
      }
    } else {
      const next = this.computeNext(msg)
      if (next) {
        this.db.prepare('UPDATE scheduled_messages SET next_send_at = ? WHERE id = ?').run(next.toISOString(), id)
        this.scheduleOne({ ...msg, next_send_at: next.toISOString() })
      } else {
        this.db.prepare('UPDATE scheduled_messages SET is_active = 0 WHERE id = ?').run(id)
      }
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('scheduled:updated')
    }
  }

  /**
   * Calcola il prossimo orario di invio per un messaggio ricorrente.
   * Per recurrence custom usa una cron string in `recurrence_rule`.
   * Per le ricorrenze standard avanza dalla base `scheduled_at` oppure
   * dall'ultimo `next_send_at`, finché non supera "now".
   */
  computeNext(msg) {
    const now = new Date()

    if (msg.recurrence_type === 'custom' && msg.recurrence_rule) {
      try {
        const job = schedule.scheduleJob(msg.recurrence_rule, () => {})
        if (!job) return null
        const next = job.nextInvocation()
        job.cancel()
        return next ? new Date(next) : null
      } catch (e) {
        console.error('[Scheduler] cron parse error:', e)
        return null
      }
    }

    let date = new Date(msg.next_send_at || msg.scheduled_at)
    if (Number.isNaN(date.getTime())) return null

    const advance = (d) => {
      switch (msg.recurrence_type) {
        case 'daily':   d.setDate(d.getDate() + 1); break
        case 'weekly':  d.setDate(d.getDate() + 7); break
        case 'monthly': d.setMonth(d.getMonth() + 1); break
        default: return null
      }
      return d
    }

    // Avanza fino a superare "now" (per riallineare job persi mentre l'app era chiusa)
    let safety = 0
    while (date <= now && safety < 1000) {
      const r = advance(date)
      if (!r) return null
      safety++
    }
    return date
  }

  reschedule(msg) { this.scheduleOne(msg) }

  remove(id) {
    this.cancelOne(id)
    this.db.prepare('UPDATE scheduled_messages SET is_active = 0 WHERE id = ?').run(id)
  }

  shutdown() {
    for (const id of this.jobs.keys()) this.cancelOne(id)
  }
}

module.exports = { Scheduler }

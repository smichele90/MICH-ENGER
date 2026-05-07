const { Boom } = require('@hapi/boom')
const pino = require('pino')
const { app, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

const logger = pino({ level: 'warn' })

// Baileys è ESM-only: viene caricato una sola volta con import() dinamico
let _baileysPromise = null
function loadBaileys() {
  if (!_baileysPromise) _baileysPromise = import('@whiskeysockets/baileys')
  return _baileysPromise
}

// Utilità inline (evitano la dipendenza ESM nei metodi sincroni)
function isJidGroup(jid) { return typeof jid === 'string' && jid.endsWith('@g.us') }
function isJidBroadcast(jid) { return typeof jid === 'string' && jid.endsWith('@broadcast') }
function getContentType(message) {
  if (!message) return null
  const skip = new Set(['messageContextInfo', 'messageStubType', 'messageStubParameters', 'key', 'status'])
  return Object.keys(message).find(k => !skip.has(k)) || null
}

class WhatsAppManager {
  constructor(db, mainWindow) {
    this.db = db
    this.mainWindow = mainWindow
    this.sockets = new Map()      // accountId → WASocket
    this.initializing = new Map() // accountId → Promise<boolean>
    this.syncing = new Set()
    // Avvia il caricamento di baileys subito in background
    loadBaileys().catch(err => console.error('[WA] Impossibile caricare baileys:', err))
    this.initHandlers()
    this.autoInitializeAccounts()
  }

  // ---------- helpers ----------

  safeSend(channel, payload) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    try { this.mainWindow.webContents.send(channel, payload) } catch (e) { /* finestra in chiusura */ }
  }

  normalizeJid(jid) {
    if (!jid) return null
    if (jid.endsWith('@g.us')) return jid
    return jid.replace('@c.us', '@s.whatsapp.net')
  }

  isSystemChat(waId) {
    if (!waId || typeof waId !== 'string') return true
    if (waId === 'status@broadcast') return true
    if (waId === '0@c.us' || waId === '0@s.whatsapp.net') return true
    if (waId.endsWith('@broadcast')) return true
    return false
  }

  getMediaType(msg) {
    const ct = getContentType(msg.message)
    const map = {
      conversation: 'text', extendedTextMessage: 'text',
      imageMessage: 'image', videoMessage: 'video',
      audioMessage: 'audio', pttMessage: 'audio',
      documentMessage: 'document', stickerMessage: 'sticker',
    }
    return map[ct] || 'text'
  }

  getMsgBody(msg) {
    const m = msg.message
    if (!m) return ''
    return m.conversation
      || m.extendedTextMessage?.text
      || m.imageMessage?.caption
      || m.videoMessage?.caption
      || m.documentMessage?.caption
      || m.documentMessage?.fileName
      || ''
  }

  hasMedia(msg) {
    const ct = getContentType(msg.message)
    return ['imageMessage', 'videoMessage', 'audioMessage', 'pttMessage', 'documentMessage', 'stickerMessage'].includes(ct)
  }

  extractMediaMeta(msg) {
    const ct = getContentType(msg.message)
    if (!ct || !msg.message?.[ct]) return {}
    const c = msg.message[ct]
    let mediaThumb = null
    if (c.jpegThumbnail && c.jpegThumbnail.length > 0) {
      const buf = Buffer.isBuffer(c.jpegThumbnail) ? c.jpegThumbnail : Buffer.from(c.jpegThumbnail)
      mediaThumb = `data:image/jpeg;base64,${buf.toString('base64')}`
    }
    return {
      mediaDuration: c.seconds || null,
      mediaSize: c.fileLength ? Number(c.fileLength) : null,
      mediaWidth: c.width || null,
      mediaHeight: c.height || null,
      mediaMime: c.mimetype || null,
      mediaFilename: c.fileName || null,
      mediaThumb,
    }
  }

  toTimestamp(ts) {
    if (!ts) return new Date().toISOString()
    const num = typeof ts === 'object' && ts.toNumber ? ts.toNumber() : Number(ts)
    return new Date(num * 1000).toISOString()
  }

  // ---------- auto-init ----------

  async autoInitializeAccounts() {
    const orphans = this.db.prepare(
      "SELECT id FROM accounts WHERE phone_number IS NULL OR phone_number = ''"
    ).all()
    for (const acc of orphans) {
      console.log(`[WA] Elimino account orfano id=${acc.id}`)
      this.db.prepare('DELETE FROM accounts WHERE id = ?').run(acc.id)
    }
    const activeAccounts = this.db.prepare(
      "SELECT id FROM accounts WHERE phone_number IS NOT NULL AND phone_number != ''"
    ).all()
    for (const acc of activeAccounts) {
      this.initializeClient(acc.id).catch(err => console.error(`[WA] auto-init failed ${acc.id}:`, err))
    }
  }

  // ---------- IPC ----------

  initHandlers() {
    console.log('[WA] Registrazione IPC handlers...')
    ipcMain.handle('wa:initialize', async (_, accountId) => {
      console.log(`[WA] IPC wa:initialize ricevuto, accountId=${accountId}`)
      this.initializeClient(accountId).catch(err =>
        this.safeSend('wa:error', { accountId, error: err.message }))
      return true
    })
    ipcMain.handle('wa:destroy', async (_, accountId) => this.destroyClient(accountId))

    ipcMain.handle('wa:markAsRead', async (_, accountId, contactId) => {
      const sock = this.sockets.get(accountId)
      if (!sock) return
      const contact = this.db.prepare('SELECT whatsapp_id FROM contacts WHERE id = ?').get(contactId)
      if (!contact) return
      const jid = this.normalizeJid(contact.whatsapp_id)
      try {
        const unreadMsgs = this.db.prepare(
          'SELECT wa_message_id FROM messages WHERE contact_id = ? AND is_from_me = 0 ORDER BY timestamp DESC LIMIT 20'
        ).all(contactId)
        if (unreadMsgs.length > 0) {
          await sock.readMessages(unreadMsgs.map(m => ({ remoteJid: jid, id: m.wa_message_id, fromMe: false })))
        }
        this.db.prepare('UPDATE contacts SET unread_count = 0 WHERE id = ?').run(contactId)
        this.safeSend('wa:contacts-updated', { accountId })
      } catch (err) { console.error('[WA] markAsRead error:', err) }
    })

    ipcMain.handle('wa:markAllAsRead', async (_, accountId) => {
      this.db.prepare('UPDATE contacts SET unread_count = 0 WHERE account_id = ?').run(accountId)
      this.safeSend('wa:contacts-updated', { accountId })
      return true
    })

    ipcMain.handle('wa:resetHistory', async (_, accountId) => {
      try {
        this.db.prepare('DELETE FROM messages WHERE account_id = ?').run(accountId)
        this.db.prepare('UPDATE contacts SET last_message_at = NULL, unread_count = 0 WHERE account_id = ?').run(accountId)
        await this.destroyClient(accountId)
        await this.initializeClient(accountId)
        return { success: true }
      } catch (err) {
        console.error('[WA] resetHistory error:', err)
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('wa:syncChatHistory', async (_, accountId) => {
      this.safeSend('wa:history-synced', { accountId })
      return { success: true }
    })

    ipcMain.handle('wa:sendMessage', async (_, accountId, contactId, body, options = {}) => {
      const sock = this.sockets.get(accountId)
      if (!sock) throw new Error('WhatsApp non è ancora connesso. Attendi qualche istante.')
      const contact = this.db.prepare('SELECT whatsapp_id FROM contacts WHERE id = ?').get(contactId)
      if (!contact) throw new Error('Contatto non trovato')
      const jid = this.normalizeJid(contact.whatsapp_id)
      try {
        let content
        if (options.mediaPath || options.mediaData) {
          let buffer
          if (options.mediaPath) {
            if (!fs.existsSync(options.mediaPath)) throw new Error(`File non trovato: ${options.mediaPath}`)
            buffer = fs.readFileSync(options.mediaPath)
          } else {
            buffer = Buffer.from(options.mediaData, 'base64')
          }
          const mime = options.mediaMime || 'application/octet-stream'
          const caption = options.caption || body || ''
          if (mime.startsWith('image/')) {
            content = { image: buffer, mimetype: mime, caption }
          } else if (mime.startsWith('video/')) {
            content = { video: buffer, mimetype: mime, caption }
          } else if (mime.startsWith('audio/')) {
            content = { audio: buffer, mimetype: mime, ptt: false }
          } else {
            const filename = options.filename || path.basename(options.mediaPath || 'file')
            content = { document: buffer, mimetype: mime, fileName: filename, caption }
          }
        } else {
          content = { text: body }
        }
        const sent = await sock.sendMessage(jid, content)
        await this.handleIncomingMessage(accountId, sent, { incrementUnread: false, downloadMedia: false })

        // Salva il path originale del media inviato per mostrarlo subito senza ri-scaricare
        if (options.mediaPath || options.mediaData) {
          const storedMsg = this.db.prepare(
            'SELECT id FROM messages WHERE account_id=? AND wa_message_id=?'
          ).get(accountId, sent.key.id)
          if (storedMsg) {
            let savedPath = options.mediaPath || null
            if (!savedPath && options.mediaData) {
              const mediaDir = path.join(app.getPath('userData'), 'media', accountId.toString())
              fs.mkdirSync(mediaDir, { recursive: true })
              const ext = (options.mediaMime || 'audio/webm').split('/')[1]?.split(';')[0] || 'webm'
              savedPath = path.join(mediaDir, `sent-${sent.key.id}.${ext}`)
              fs.writeFileSync(savedPath, Buffer.from(options.mediaData, 'base64'))
            }
            if (savedPath) {
              this.db.prepare('UPDATE messages SET media_path=? WHERE id=?').run(savedPath, storedMsg.id)
            }
          }
        }

        return { id: sent.key.id, timestamp: Number(sent.messageTimestamp) }
      } catch (err) {
        console.error('[WA] sendMessage error:', err)
        throw err
      }
    })

    ipcMain.handle('wa:downloadMedia', async (_, accountId, messageDbId) => {
      try {
        const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(messageDbId)
        if (!row) return { success: false, error: 'Messaggio non trovato' }
        if (row.media_path && fs.existsSync(row.media_path)) {
          return { success: true, media_path: row.media_path, media_mime: row.media_mime, media_filename: row.media_filename }
        }
        if (!row.wa_raw_message) {
          return { success: false, error: 'Dati originali non disponibili (messaggio sincronizzato con versione precedente)' }
        }
        const waMsg = JSON.parse(row.wa_raw_message)
        const saved = await this.downloadAndSaveMedia(accountId, waMsg)
        if (!saved) return { success: false, error: 'Download fallito' }
        this.db.prepare('UPDATE messages SET media_path=?, media_mime=?, media_filename=?, media_size=? WHERE id=?')
          .run(saved.path, saved.mime, saved.filename, saved.size || row.media_size, messageDbId)
        return { success: true, media_path: saved.path, media_mime: saved.mime, media_filename: saved.filename }
      } catch (err) {
        console.error('[WA] downloadMedia error:', err)
        return { success: false, error: err.message }
      }
    })
  }

  // ---------- destroy ----------

  async destroyClient(accountId) {
    const sock = this.sockets.get(accountId)
    if (sock) {
      try { sock.ev.removeAllListeners() } catch {}
      try { sock.ws.close() } catch {}
      this.sockets.delete(accountId)
    }
    this.syncing.delete(accountId)
    this.db.prepare('UPDATE accounts SET is_active = 0 WHERE id = ?').run(accountId)
    return true
  }

  // ---------- send programmati ----------

  async sendScheduledTo(msg) {
    const sock = this.sockets.get(msg.account_id)
    if (!sock) {
      console.error(`[WA] Socket ${msg.account_id} non pronto per scheduled ${msg.id}`)
      return false
    }
    try {
      let targets = []
      if (msg.target_type === 'contact' || msg.target_type === 'group') {
        const c = this.db.prepare('SELECT whatsapp_id FROM contacts WHERE id = ?').get(msg.target_id)
        if (c) targets.push(this.normalizeJid(c.whatsapp_id))
      } else if (msg.target_type === 'folder') {
        const members = this.db.prepare(
          'SELECT c.whatsapp_id FROM contacts c JOIN folder_members fm ON fm.contact_id = c.id WHERE fm.folder_id = ?'
        ).all(msg.target_id)
        targets = members.map(m => this.normalizeJid(m.whatsapp_id))
      }
      for (const jid of targets) {
        await sock.sendMessage(jid, { text: msg.body })
        await new Promise(r => setTimeout(r, 800))
      }
      return true
    } catch (err) {
      console.error(`[WA] scheduled send error ${msg.id}:`, err)
      return false
    }
  }

  // ---------- init client (idempotente) ----------

  async initializeClient(accountId) {
    console.log(`[WA] initializeClient: id=${accountId}, haSocket=${this.sockets.has(accountId)}, isInit=${this.initializing.has(accountId)}`)
    if (this.sockets.has(accountId)) return true
    if (this.initializing.has(accountId)) return this.initializing.get(accountId)
    const promise = this._doInitialize(accountId).finally(() => this.initializing.delete(accountId))
    this.initializing.set(accountId, promise)
    return promise
  }

  async _doInitialize(accountId) {
    console.log(`[WA] _doInitialize chiamata per account ${accountId}`)
    const account = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
    if (!account) {
      console.log(`[WA] Account ${accountId} non trovato in DB!`)
      return false
    }

    // Carica baileys (ESM) tramite import() dinamico
    let baileys
    try {
      baileys = await loadBaileys()
    } catch (err) {
      console.error(`[WA] Impossibile caricare baileys:`, err)
      this.safeSend('wa:error', { accountId, error: err.message })
      return false
    }
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
      Browsers,
    } = baileys

    console.log(`[WA] _doInitialize start: account ${accountId}`)

    const sessDir = path.join(app.getPath('userData'), 'sessions', `account-${accountId}`)
    fs.mkdirSync(sessDir, { recursive: true })

    let state, saveCreds
    try {
      console.log(`[WA] useMultiFileAuthState per account ${accountId}...`)
      ;({ state, saveCreds } = await useMultiFileAuthState(sessDir))
      console.log(`[WA] Session state caricato per account ${accountId}`)
    } catch (err) {
      console.error(`[WA] useMultiFileAuthState failed ${accountId}:`, err)
      this.safeSend('wa:error', { accountId, error: err.message })
      return false
    }

    // fetchLatestBaileysVersion fa una richiesta HTTP — timeout di 5s per evitare blocchi
    let version = [2, 3000, 1015901307]
    try {
      console.log(`[WA] fetchLatestBaileysVersion per account ${accountId}...`)
      const result = await Promise.race([
        fetchLatestBaileysVersion(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
      ])
      version = result.version
      console.log(`[WA] Versione WA: ${version}`)
    } catch (err) {
      console.warn(`[WA] fetchLatestBaileysVersion fallito (${err.message}), uso versione fallback`)
    }

    console.log(`[WA] makeWASocket per account ${accountId}...`)
    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      browser: Browsers.ubuntu('Desktop'),
      getMessage: async (key) => {
        const stored = this.db.prepare(
          'SELECT wa_raw_message FROM messages WHERE account_id=? AND wa_message_id=?'
        ).get(accountId, key.id)
        if (stored?.wa_raw_message) {
          try { return JSON.parse(stored.wa_raw_message) } catch {}
        }
        return { conversation: '' }
      },
    })

    this.sockets.set(accountId, sock)
    sock.ev.on('creds.update', saveCreds)
    console.log(`[WA] Socket creato per account ${accountId}, in attesa di connection.update...`)

    // ---------- connection.update ----------
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log(`[WA] QR per account ${accountId}`)
        this.safeSend('wa:qr', { accountId, qr })
        this.safeSend('wa:loading', { accountId, percent: 10, message: 'Scansiona il QR code' })
      }
      if (connection === 'connecting') {
        this.safeSend('wa:loading', { accountId, percent: 50, message: 'Connessione in corso...' })
      }
      if (connection === 'open') {
        console.log(`[WA] Account ${accountId} connesso`)
        const user = sock.user
        const phoneNumber = user.id.split(':')[0]
        const pushname = user.name || ''
        this.db.prepare('UPDATE accounts SET phone_number=?, name=?, is_active=1 WHERE id=?')
          .run(phoneNumber, pushname, accountId)
        this.safeSend('wa:ready', { accountId, info: { pushname, wid: { user: phoneNumber } } })
      }
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error instanceof Boom)
          ? lastDisconnect.error.output.statusCode
          : null
        const isLoggedOut = statusCode === DisconnectReason.loggedOut
          || statusCode === DisconnectReason.forbidden

        console.log(`[WA] Account ${accountId} disconnesso, statusCode=${statusCode}`)
        this.db.prepare('UPDATE accounts SET is_active=0 WHERE id=?').run(accountId)
        this.sockets.delete(accountId)
        this.syncing.delete(accountId)

        if (isLoggedOut) {
          try { fs.rmSync(sessDir, { recursive: true, force: true }) } catch {}
          this.safeSend('wa:disconnected', { accountId, reason: 'logged_out' })
        } else {
          this.safeSend('wa:disconnected', { accountId, reason: 'connection_closed' })
          const delay = statusCode === DisconnectReason.restartRequired ? 0 : 5000
          setTimeout(() => {
            if (!this.sockets.has(accountId)) {
              this.initializeClient(accountId).catch(err =>
                console.error(`[WA] reconnect failed ${accountId}:`, err))
            }
          }, delay)
        }
      }
    })

    // ---------- messaggi in tempo reale ----------
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return
      for (const msg of messages) {
        await this.handleIncomingMessage(accountId, msg, { incrementUnread: true, downloadMedia: false })
      }
    })

    // ---------- sync iniziale ----------
    sock.ev.on('messaging-history.set', async ({ messages, chats, contacts, isLatest }) => {
      console.log(`[WA] History set account ${accountId}: ${messages.length} msg, ${chats.length} chat, ${contacts.length} contatti, isLatest=${isLatest}`)
      try {
        await this.processHistoryContacts(accountId, contacts, chats)
        for (const msg of messages) {
          await this.handleIncomingMessage(accountId, msg, { incrementUnread: false, downloadMedia: false })
        }
        if (isLatest) {
          this.updateProfilePics(accountId, sock).catch(() => {})
          this.safeSend('wa:history-synced', { accountId })
          this.safeSend('wa:contacts-updated', { accountId })
          this.safeSend('wa:contacts-synced', { accountId })
        }
      } catch (err) {
        console.error(`[WA] messaging-history.set error account ${accountId}:`, err)
      }
    })

    // ---------- contatti/chat iniziali (bulk) ----------
    sock.ev.on('contacts.set', ({ contacts, isLatest }) => {
      console.log(`[WA] contacts.set account ${accountId}: ${contacts.length} contatti, isLatest=${isLatest}`)
      this.upsertBaileysContacts(accountId, contacts)
      if (isLatest) {
        this.updateProfilePics(accountId, sock).catch(() => {})
        this.safeSend('wa:history-synced', { accountId })
        this.safeSend('wa:contacts-synced', { accountId })
      }
      this.safeSend('wa:contacts-updated', { accountId })
    })

    // ---------- contatti/chat incrementali ----------
    sock.ev.on('contacts.upsert', (contacts) => {
      console.log(`[WA] contacts.upsert account ${accountId}: ${contacts.length} contatti`)
      this.upsertBaileysContacts(accountId, contacts)
      this.safeSend('wa:contacts-updated', { accountId })
    })

    sock.ev.on('chats.upsert', (chats) => {
      console.log(`[WA] chats.upsert account ${accountId}: ${chats.length} chat`)
      const insertContact = this.db.prepare(`
        INSERT OR IGNORE INTO contacts (account_id, whatsapp_id, name, is_group, phone_number)
        VALUES (?, ?, '', ?, ?)
      `)
      for (const chat of chats) {
        if (!chat.id || this.isSystemChat(chat.id)) continue
        const jid = this.normalizeJid(chat.id)
        const isGroup = isJidGroup(jid) ? 1 : 0
        const phone = isGroup ? '' : jid.split('@')[0]
        insertContact.run(accountId, jid, isGroup, phone)
        const ts = chat.conversationTimestamp
          ? new Date(Number(chat.conversationTimestamp) * 1000).toISOString()
          : null
        this.db.prepare(`
          UPDATE contacts
          SET unread_count = ?,
              last_message_at = CASE WHEN ? IS NOT NULL AND (last_message_at IS NULL OR last_message_at < ?) THEN ? ELSE last_message_at END
          WHERE account_id = ? AND whatsapp_id = ?
        `).run(chat.unreadCount || 0, ts, ts, ts, accountId, jid)
      }
      this.safeSend('wa:contacts-updated', { accountId })
    })

    return true // ritorna subito — QR e ready arrivano via eventi
  }

  // ---------- sync contatti da history ----------

  async processHistoryContacts(accountId, contacts, chats) {
    const upsert = this.db.prepare(`
      INSERT INTO contacts (account_id, whatsapp_id, name, push_name, phone_number, is_group)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, whatsapp_id) DO UPDATE SET
        name = CASE WHEN excluded.name != '' THEN excluded.name ELSE contacts.name END,
        push_name = CASE WHEN excluded.push_name != '' THEN excluded.push_name ELSE contacts.push_name END,
        phone_number = CASE WHEN excluded.phone_number != '' THEN excluded.phone_number ELSE contacts.phone_number END,
        is_group = excluded.is_group
    `)
    const unreadMap = {}
    const timestampMap = {}
    for (const chat of chats) {
      if (chat.id) {
        const jid = this.normalizeJid(chat.id)
        unreadMap[jid] = chat.unreadCount || 0
        if (chat.conversationTimestamp)
          timestampMap[jid] = new Date(Number(chat.conversationTimestamp) * 1000).toISOString()
      }
    }
    for (const c of contacts) {
      if (!c.id || this.isSystemChat(c.id)) continue
      const jid = this.normalizeJid(c.id)
      const isGroup = isJidGroup(jid) ? 1 : 0
      const phone = isGroup ? '' : jid.split('@')[0]
      try {
        upsert.run(accountId, jid, c.name || '', c.notify || '', phone, isGroup)
        if (unreadMap[jid] !== undefined) {
          this.db.prepare('UPDATE contacts SET unread_count=? WHERE account_id=? AND whatsapp_id=?')
            .run(unreadMap[jid], accountId, jid)
        }
        if (timestampMap[jid]) {
          this.db.prepare('UPDATE contacts SET last_message_at=? WHERE account_id=? AND whatsapp_id=? AND (last_message_at IS NULL OR last_message_at < ?)')
            .run(timestampMap[jid], accountId, jid, timestampMap[jid])
        }
      } catch (err) {
        if (!String(err.message).includes('UNIQUE')) console.error('[WA] upsertContact:', err.message)
      }
    }
  }

  upsertBaileysContacts(accountId, contacts) {
    const upsert = this.db.prepare(`
      INSERT INTO contacts (account_id, whatsapp_id, name, push_name, phone_number, is_group)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, whatsapp_id) DO UPDATE SET
        name = CASE WHEN excluded.name != '' THEN excluded.name ELSE contacts.name END,
        push_name = CASE WHEN excluded.push_name != '' THEN excluded.push_name ELSE contacts.push_name END
    `)
    for (const c of contacts) {
      if (!c.id || this.isSystemChat(c.id)) continue
      const jid = this.normalizeJid(c.id)
      const isGroup = isJidGroup(jid) ? 1 : 0
      const phone = isGroup ? '' : jid.split('@')[0]
      try { upsert.run(accountId, jid, c.name || '', c.notify || '', phone, isGroup) } catch {}
    }
  }

  async updateProfilePics(accountId, sock) {
    const contacts = this.db.prepare(
      "SELECT id, whatsapp_id FROM contacts WHERE account_id=? AND (profile_pic_url IS NULL OR profile_pic_url='') LIMIT 50"
    ).all(accountId)
    for (const c of contacts) {
      try {
        const jid = this.normalizeJid(c.whatsapp_id)
        const url = await sock.profilePictureUrl(jid, 'image')
        if (url) this.db.prepare('UPDATE contacts SET profile_pic_url=? WHERE id=?').run(url, c.id)
      } catch { /* privacy o contatto sconosciuto: normale */ }
      await new Promise(r => setTimeout(r, 150))
    }
    this.safeSend('wa:contacts-updated', { accountId })
  }

  // ---------- handle messaggio ----------

  async handleIncomingMessage(accountId, msg, opts = {}) {
    const incrementUnread = opts.incrementUnread !== false
    const downloadMedia = opts.downloadMedia === true

    if (!msg?.key?.id) return
    const remoteJid = msg.key.remoteJid
    if (!remoteJid || this.isSystemChat(remoteJid)) return
    const chatJid = this.normalizeJid(remoteJid)

    const msgId = msg.key.id
    const existing = this.db.prepare('SELECT id FROM messages WHERE account_id=? AND wa_message_id=?').get(accountId, msgId)
    if (existing) return

    const isFromMe = msg.key.fromMe ? 1 : 0
    const isGroup = isJidGroup(chatJid) ? 1 : 0
    const chatName = msg.pushName || ''
    const timestamp = this.toTimestamp(msg.messageTimestamp)
    const mediaType = this.getMediaType(msg)
    const body = this.getMsgBody(msg)
    const hasMediaFlag = this.hasMedia(msg)

    let contact = this.db.prepare('SELECT id, is_group FROM contacts WHERE account_id=? AND whatsapp_id=?').get(accountId, chatJid)
    if (!contact) {
      try {
        this.db.prepare('INSERT OR IGNORE INTO contacts (account_id, whatsapp_id, name, is_group, phone_number) VALUES (?,?,?,?,?)')
          .run(accountId, chatJid, chatName, isGroup, isGroup ? '' : chatJid.split('@')[0])
        contact = this.db.prepare('SELECT id, is_group FROM contacts WHERE account_id=? AND whatsapp_id=?').get(accountId, chatJid)
      } catch (err) {
        console.error('[WA] insert contact:', err.message)
      }
    }
    if (!contact) return

    let senderName = null
    if (contact.is_group && !isFromMe) {
      const participantJid = msg.key.participant || ''
      senderName = msg.pushName || (participantJid ? participantJid.split('@')[0] : 'Sconosciuto')
    }

    const mediaMeta = hasMediaFlag ? this.extractMediaMeta(msg) : {}
    const { mediaDuration, mediaSize, mediaWidth, mediaHeight, mediaThumb,
            mediaMime: extractedMime, mediaFilename: extractedFilename } = mediaMeta

    let waRawMessage = null
    if (hasMediaFlag) {
      try { waRawMessage = JSON.stringify(msg) } catch {}
    }

    let mediaPath = null
    let mediaMime = extractedMime || null
    let mediaFilename = extractedFilename || null
    if (hasMediaFlag && downloadMedia) {
      const saved = await this.downloadAndSaveMedia(accountId, msg)
      if (saved) { mediaPath = saved.path; mediaMime = saved.mime; mediaFilename = saved.filename }
    }

    let result
    try {
      result = this.db.prepare(`
        INSERT INTO messages (
          account_id, contact_id, wa_message_id, wa_serialized_id,
          body, media_type, media_path, media_mime, media_filename,
          media_thumb, media_duration, media_size, media_width, media_height,
          is_from_me, timestamp, status, sender_name, wa_raw_message
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        accountId, contact.id, msgId, msgId,
        body,
        hasMediaFlag ? mediaType : 'text',
        mediaPath, mediaMime, mediaFilename,
        mediaThumb || null, mediaDuration || null, mediaSize || null,
        mediaWidth || null, mediaHeight || null,
        isFromMe, timestamp, 'received', senderName, waRawMessage
      )
    } catch (err) {
      if (!String(err.message).includes('UNIQUE')) console.error('[WA] insert message:', err.message)
      return
    }

    this.db.prepare(`
      UPDATE contacts SET
        last_message_at = ?,
        unread_count = CASE WHEN ? = 0 AND ? = 1 THEN unread_count + 1 ELSE unread_count END
      WHERE id = ?
    `).run(timestamp, isFromMe, incrementUnread ? 1 : 0, contact.id)

    this.safeSend('wa:message', {
      accountId,
      message: {
        id: result.lastInsertRowid,
        account_id: accountId,
        contact_id: contact.id,
        wa_message_id: msgId,
        wa_serialized_id: msgId,
        body,
        is_from_me: isFromMe,
        timestamp,
        media_type: hasMediaFlag ? mediaType : 'text',
        media_path: mediaPath,
        media_mime: mediaMime,
        media_filename: mediaFilename,
        media_thumb: mediaThumb || null,
        media_duration: mediaDuration || null,
        media_size: mediaSize || null,
        media_width: mediaWidth || null,
        media_height: mediaHeight || null,
        sender_name: senderName,
        status: 'received'
      }
    })
  }

  // ---------- download media ----------

  async downloadAndSaveMedia(accountId, waMsg) {
    try {
      const { downloadMediaMessage } = await loadBaileys()
      const sock = this.sockets.get(accountId)
      const buffer = await downloadMediaMessage(
        waMsg, 'buffer', {},
        { logger, reuploadRequest: sock ? sock.updateMediaMessage.bind(sock) : undefined }
      )
      if (!buffer || buffer.length === 0) return null

      const mediaDir = path.join(app.getPath('userData'), 'media', accountId.toString())
      if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true })

      const ct = getContentType(waMsg.message)
      const content = waMsg.message?.[ct] || {}
      const mime = content.mimetype || 'application/octet-stream'
      const ext = (mime.split('/')[1] || 'bin').split(';')[0]
      const msgId = waMsg.key.id
      const filename = content.fileName || `${msgId}.${ext}`
      const fullPath = path.join(mediaDir, `${msgId}.${ext}`)

      fs.writeFileSync(fullPath, buffer)
      const stat = fs.statSync(fullPath)
      return { path: fullPath, mime, filename, size: stat.size }
    } catch (err) {
      console.error('[WA] media download error:', err.message)
      return null
    }
  }
}

module.exports = { WhatsAppManager }

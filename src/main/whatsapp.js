const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js')
const { app, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { updateMessageAck, upsertReaction, deleteReaction } = require('./database')

/**
 * WhatsAppManager riprogettato per essere robusto come WhatsApp Web:
 *  - Init idempotente (nessuna race condition: due chiamate concorrenti
 *    condividono la stessa Promise di inizializzazione).
 *  - Lock di sync per account (un solo sync per volta, niente doppioni).
 *  - Media NON scaricati durante il bulk sync (lazy on-demand quando il
 *    renderer apre la chat). I messaggi con `hasMedia` sono salvati con
 *    `media_path = NULL` e flag `media_pending = 1`.
 *  - Tutti i `webContents.send` passano per `safeSend` (no crash su
 *    finestra distrutta).
 *  - protocolTimeout di puppeteer alzato a 3 minuti.
 *  - authorId dei gruppi normalizzato a stringa.
 */
class WhatsAppManager {
  constructor(db, mainWindow) {
    this.db = db
    this.mainWindow = mainWindow
    this.clients = new Map()        // accountId -> Client
    this.initializing = new Map()   // accountId -> Promise<boolean>
    this.syncing = new Set()        // accountId attualmente in sync
    this.lastSyncAt = new Map()     // accountId -> timestamp ultimo sync
    this.initHandlers()
    this.autoInitializeAccounts()
  }

  // ---------- helpers ----------

  safeSend(channel, payload) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    try { this.mainWindow.webContents.send(channel, payload) } catch (e) { /* finestra in chiusura */ }
  }

  toIdString(id) {
    if (!id) return null
    if (typeof id === 'string') return id
    if (id._serialized) return id._serialized
    if (id.user && id.server) return `${id.user}@${id.server}`
    try { return String(id) } catch { return null }
  }

  // Filtra le entità "di sistema" che NON sono vere conversazioni:
  //  - status@broadcast (gli stati/storie di tutti i contatti)
  //  - 0@c.us (notifiche WhatsApp ufficiali in alcuni casi)
  //  - liste broadcast (suffisso @broadcast)
  isSystemChat(waId) {
    if (!waId || typeof waId !== 'string') return true
    if (waId === 'status@broadcast') return true
    if (waId === '0@c.us') return true
    if (waId.endsWith('@broadcast') && waId !== 'status@broadcast') return true
    return false
  }

  async autoInitializeAccounts() {
    // Elimina account orfani (creati durante tentativi di pairing falliti/interrotti)
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
    ipcMain.handle('wa:initialize', async (_, accountId) => this.initializeClient(accountId))
    ipcMain.handle('wa:destroy', async (_, accountId) => this.destroyClient(accountId))

    ipcMain.handle('wa:markAsRead', async (_, accountId, contactId) => {
      const client = this.clients.get(accountId)
      if (!client) return
      const contact = this.db.prepare('SELECT whatsapp_id FROM contacts WHERE id = ?').get(contactId)
      if (!contact) return
      try {
        const chat = await client.getChatById(contact.whatsapp_id)
        if (chat) {
          await chat.sendSeen()
          this.db.prepare('UPDATE contacts SET unread_count = 0 WHERE id = ?').run(contactId)
          this.safeSend('wa:contacts-updated', { accountId })
        }
      } catch (err) { console.error('[WA] markAsRead error:', err) }
    })

    ipcMain.handle('wa:markAllAsRead', async (_, accountId) => {
      this.db.prepare('UPDATE contacts SET unread_count = 0 WHERE account_id = ?').run(accountId)
      this.safeSend('wa:contacts-updated', { accountId })
      return true
    })

    ipcMain.handle('wa:resetHistory', async (_, accountId) => {
      try {
        const client = this.clients.get(accountId)
        if (!client) throw new Error('WhatsApp non connesso')
        this.db.prepare('DELETE FROM messages WHERE account_id = ?').run(accountId)
        this.db.prepare('UPDATE contacts SET last_message_at = NULL, unread_count = 0 WHERE account_id = ?').run(accountId)
        this.lastSyncAt.delete(accountId)
        await this.runSync(accountId, client)
        return { success: true }
      } catch (err) {
        console.error('[WA] resetHistory error:', err)
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('wa:syncChatHistory', async (_, accountId, contactId) => {
      try {
        const client = this.clients.get(accountId)
        if (!client) throw new Error('WhatsApp non connesso')
        const contact = this.db.prepare('SELECT whatsapp_id FROM contacts WHERE id = ?').get(contactId)
        if (!contact) throw new Error('Contatto non trovato')
        const chat = await client.getChatById(contact.whatsapp_id)
        if (!chat) throw new Error('Chat non trovata')
        const messages = await chat.fetchMessages({ limit: 1000 })
        for (const msg of messages) {
          await this.handleIncomingMessage(accountId, msg, { incrementUnread: false, downloadMedia: false })
        }
        this.safeSend('wa:history-synced', { accountId })
        return { success: true }
      } catch (err) {
        console.error('[WA] syncChatHistory error:', err)
        return { success: false, error: err.message }
      }
    })

    ipcMain.handle('wa:sendMessage', async (_, accountId, contactId, body, options = {}) => {
      const client = this.clients.get(accountId)
      if (!client) throw new Error('WhatsApp non è ancora connesso. Attendi qualche istante.')
      const contact = this.db.prepare('SELECT whatsapp_id FROM contacts WHERE id = ?').get(contactId)
      if (!contact) throw new Error('Contatto non trovato')
      try {
        let payload = body
        const sendOptions = {}

        if (options.caption) {
          sendOptions.caption = options.caption
        }

        if (options.mediaPath || options.mediaData) {
          if (options.mediaPath) {
            if (!fs.existsSync(options.mediaPath)) {
              throw new Error(`File non trovato: ${options.mediaPath}`)
            }
            payload = MessageMedia.fromFilePath(options.mediaPath)
          } else {
            if (!options.mediaMime || !options.mediaData) {
              throw new Error('Dati media incompleti')
            }
            const filename = options.filename || `file.${options.mediaMime.split('/')[1] || 'bin'}`
            payload = new MessageMedia(options.mediaMime, options.mediaData, filename)
          }
        }

        const msg = await client.sendMessage(contact.whatsapp_id, payload, sendOptions)
        await this.handleIncomingMessage(accountId, msg, { incrementUnread: false, downloadMedia: false })
        return { id: msg.id.id, timestamp: msg.timestamp }
      } catch (err) {
        console.error('[WA] sendMessage error:', err)
        throw err
      }
    })

    // Download media on-demand (chiamato quando il renderer apre un messaggio media)
    ipcMain.handle('wa:downloadMedia', async (_, accountId, messageDbId) => {
      try {
        const client = this.clients.get(accountId)
        if (!client) return { success: false, error: 'Non connesso' }

        const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(messageDbId)
        if (!row) return { success: false, error: 'Messaggio non trovato' }
        if (row.media_path && fs.existsSync(row.media_path)) {
          return { success: true, media_path: row.media_path, media_mime: row.media_mime, media_filename: row.media_filename }
        }

        // Strategia 1 (preferita): getMessageById con il serialized id
        let msg = null
        if (row.wa_serialized_id) {
          try {
            msg = await client.getMessageById(row.wa_serialized_id)
          } catch (e) {
            console.warn('[WA] getMessageById failed, fallback fetchMessages:', e.message)
          }
        }

        // Strategia 2 (fallback): scorri la chat con limite generoso
        if (!msg) {
          const contact = this.db.prepare('SELECT whatsapp_id FROM contacts WHERE id = ?').get(row.contact_id)
          if (!contact) return { success: false, error: 'Contatto non trovato' }
          const chat = await client.getChatById(contact.whatsapp_id)
          const messages = await chat.fetchMessages({ limit: 1000 })
          msg = messages.find(m => m.id?._serialized === row.wa_serialized_id || m.id?.id === row.wa_message_id)
        }

        if (!msg) return { success: false, error: 'Messaggio non trovato sul server WhatsApp' }
        if (!msg.hasMedia) return { success: false, error: 'Il messaggio non contiene media' }

        const saved = await this.downloadAndSaveMedia(accountId, msg)
        if (!saved) return { success: false, error: 'Download fallito' }

        this.db.prepare('UPDATE messages SET media_path = ?, media_mime = ?, media_filename = ?, media_size = ? WHERE id = ?')
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
    const client = this.clients.get(accountId)
    if (client) {
      try { await client.destroy() } catch (err) { console.error(`[WA] destroy error ${accountId}:`, err) }
      this.clients.delete(accountId)
    }
    this.syncing.delete(accountId)
    this.lastSyncAt.delete(accountId)
    return true
  }

  // ---------- send programmati (chiamato dallo Scheduler) ----------

  async sendScheduledTo(msg) {
    const client = this.clients.get(msg.account_id)
    if (!client) {
      console.error(`[WA] Client ${msg.account_id} non pronto per scheduled ${msg.id}`)
      return false
    }
    try {
      let targets = []
      if (msg.target_type === 'contact' || msg.target_type === 'group') {
        const c = this.db.prepare('SELECT whatsapp_id FROM contacts WHERE id = ?').get(msg.target_id)
        if (c) targets.push(c.whatsapp_id)
      } else if (msg.target_type === 'folder') {
        const members = this.db.prepare(
          'SELECT c.whatsapp_id FROM contacts c JOIN folder_members fm ON fm.contact_id = c.id WHERE fm.folder_id = ?'
        ).all(msg.target_id)
        targets = members.map(m => m.whatsapp_id)
      }
      for (const waId of targets) {
        await client.sendMessage(waId, msg.body)
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
    if (this.clients.has(accountId)) return true
    if (this.initializing.has(accountId)) return this.initializing.get(accountId)

    const promise = this._doInitialize(accountId).finally(() => {
      this.initializing.delete(accountId)
    })
    this.initializing.set(accountId, promise)
    return promise
  }

  async _doInitialize(accountId) {
    const account = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
    if (!account) return false

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: `account-${accountId}`,
        dataPath: path.join(app.getPath('userData'), 'sessions')
      }),
      puppeteer: {
        headless: true,
        protocolTimeout: 180_000, // 3 min — evita timeout su sync di chat con molti messaggi
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-extensions',
          '--no-first-run',
          '--disable-gpu',
          '--disable-gpu-sandbox',
          '--disable-software-rasterizer',
          '--disable-background-networking',
          '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ],
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false
      }
    })

    // CRUCIALE: registra il client nella mappa SUBITO, prima di async/await,
    // così le chiamate concorrenti vedono che esiste e non creano un secondo client.
    this.clients.set(accountId, client)

    client.on('qr', (qr) => {
      console.log(`[WA] QR per account ${accountId}`)
      this.safeSend('wa:qr', { accountId, qr })
    })

    client.on('loading_screen', (percent, message) => {
      console.log(`[WA] Loading ${percent}% - ${message}`)
      this.safeSend('wa:loading', { accountId, percent, message })
    })

    client.on('ready', async () => {
      const info = client.info
      this.db.prepare('UPDATE accounts SET phone_number = ?, name = ?, is_active = 1 WHERE id = ?')
        .run(info.wid.user, info.pushname || '', accountId)
      this.safeSend('wa:ready', { accountId, info: { pushname: info.pushname, wid: info.wid } })

      // Sync una sola volta (lock interno)
      this.runSync(accountId, client).catch(err => console.error('[WA] sync error:', err))
    })

    client.on('message', async (msg) => {
      await this.handleIncomingMessage(accountId, msg, { incrementUnread: true, downloadMedia: true })
    })

    client.on('message_create', async (msg) => {
      if (msg.fromMe) await this.handleIncomingMessage(accountId, msg, { incrementUnread: false, downloadMedia: true })
    })

    client.on('message_ack', (msg, ack) => {
      const serializedId = msg.id?._serialized
      if (!serializedId) return
      try {
        updateMessageAck(serializedId, ack)
        this.safeSend('wa:message-ack', { accountId, waSerializedId: serializedId, ack })
      } catch (err) { console.error('[WA] message_ack error:', err.message) }
    })

    client.on('message_reaction', async (reaction) => {
      try {
        const waSerializedId = reaction.msgId?._serialized
        const senderWaId = this.toIdString(reaction.senderId)
        if (!waSerializedId || !senderWaId) return
        const isRemoval = !reaction.reaction || reaction.reaction === ''
        const msgRow = this.db.prepare('SELECT id FROM messages WHERE wa_serialized_id = ?').get(waSerializedId)
        if (!msgRow) return
        let senderName = senderWaId.split('@')[0]
        try {
          const c = await client.getContactById(senderWaId)
          senderName = c?.pushname || c?.name || senderName
        } catch {}
        if (isRemoval) {
          deleteReaction(waSerializedId, senderWaId)
        } else {
          upsertReaction(waSerializedId, reaction.reaction, senderWaId, senderName, new Date().toISOString(), msgRow.id)
        }
        this.safeSend('wa:reaction', { accountId, waSerializedId, emoji: reaction.reaction, senderWaId, senderName, removed: isRemoval })
      } catch (err) { console.error('[WA] message_reaction error:', err.message) }
    })

    client.on('disconnected', (reason) => {
      console.log(`[WA] Account ${accountId} disconnesso:`, reason)
      this.db.prepare('UPDATE accounts SET is_active = 0 WHERE id = ?').run(accountId)
      this.safeSend('wa:disconnected', { accountId, reason })
      this.clients.delete(accountId)
    })

    try {
      console.log(`[WA] Init account ${accountId}...`)
      await client.initialize()
    } catch (err) {
      console.error(`[WA] init critico account ${accountId}:`, err)
      this.clients.delete(accountId)
      this.safeSend('wa:error', { accountId, error: err.message })
      return false
    }
    return true
  }

  // ---------- sync (con lock) ----------

  async runSync(accountId, client) {
    if (this.syncing.has(accountId)) {
      console.log(`[WA] Sync già in corso per ${accountId}, skip`)
      return
    }
    const lastSync = this.lastSyncAt.get(accountId) || 0
    if (Date.now() - lastSync < 5 * 60 * 1000) {
      console.log(`[WA] Sync troppo recente per ${accountId}, skip`)
      return
    }
    this.syncing.add(accountId)
    this.lastSyncAt.set(accountId, Date.now())
    try {
      await this.syncRecentChats(accountId, client)
      await this.syncContacts(accountId, client)
    } finally {
      this.syncing.delete(accountId)
    }
  }

  // Usa client.getChats() — l'elenco chat ordinato da WhatsApp per attività reale —
  // invece del DB locale (che è stale per chat con nuovi messaggi arrivati offline).
  async syncRecentChats(accountId, client) {
    console.log(`[WA] Sync chat recenti (da WhatsApp) per account ${accountId}...`)

    let waChats
    try {
      waChats = await client.getChats()
    } catch (err) {
      console.error('[WA] getChats failed:', err.message)
      return
    }

    // Prende le prime 25 chat non di sistema, già ordinate per attività da WA
    const chats = waChats
      .filter(c => !this.isSystemChat(this.toIdString(c.id)))
      .slice(0, 25)

    console.log(`[WA] ${chats.length} chat recenti da sincronizzare`)
    let totalNew = 0

    for (const chat of chats) {
      const chatWaId = this.toIdString(chat.id)
      if (!chatWaId) continue

      try {
        // Aggiorna unread_count con il valore reale dal server
        const serverUnread = chat.unreadCount || 0
        this.db.prepare('UPDATE contacts SET unread_count = ? WHERE account_id = ? AND whatsapp_id = ?')
          .run(serverUnread, accountId, chatWaId)

        // Trova l'ultimo messaggio locale per decidere da dove riprendere
        const lastLocalMsg = this.db.prepare(`
          SELECT timestamp FROM messages
          WHERE contact_id = (SELECT id FROM contacts WHERE account_id = ? AND whatsapp_id = ?)
          ORDER BY timestamp DESC LIMIT 1
        `).get(accountId, chatWaId)

        const messages = await chat.fetchMessages({ limit: 20 })
        let newMessages = 0

        for (const msg of messages) {
          if (lastLocalMsg && msg.timestamp <= Math.floor(new Date(lastLocalMsg.timestamp).getTime() / 1000)) {
            continue
          }
          await this.handleIncomingMessage(accountId, msg, { incrementUnread: false, downloadMedia: false })
          newMessages++
        }

        if (newMessages > 0) {
          console.log(`[WA] Chat ${chat.name}: ${newMessages} nuovi messaggi`)
          totalNew += newMessages
        }

        // Avatar: aggiorna l'URL foto per questo contatto (solo lettura, nessun rischio)
        try {
          const waContact = await chat.getContact()
          if (waContact) {
            const picUrl = await waContact.getProfilePicUrl()
            if (picUrl) {
              this.db.prepare(
                'UPDATE contacts SET profile_pic_url = ? WHERE account_id = ? AND whatsapp_id = ?'
              ).run(picUrl, accountId, chatWaId)
            }
          }
        } catch { /* contatto con privacy pic: normale */ }
      } catch (err) {
        console.error(`[WA] sync chat ${chatWaId} error:`, err.message)
      }
    }

    console.log(`[WA] Sync completata: ${totalNew} nuovi messaggi in totale`)
    this.safeSend('wa:history-synced', { accountId })
    this.safeSend('wa:contacts-updated', { accountId })
  }

  async syncContacts(accountId, client) {
    let waContacts = []
    try { waContacts = await client.getContacts() } catch (err) {
      console.error('[WA] getContacts failed:', err)
      return
    }

    // Sincronizza solo metadati (nome, telefono, gruppo) — gli avatar sono
    // gestiti in syncRecentChats per i contatti attivi, senza download su disco.
    const upsertContact = this.db.prepare(`
      INSERT INTO contacts (account_id, whatsapp_id, name, push_name, phone_number, is_group)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, whatsapp_id) DO UPDATE SET
        name = CASE WHEN excluded.name != '' THEN excluded.name ELSE contacts.name END,
        push_name = CASE WHEN excluded.push_name != '' THEN excluded.push_name ELSE contacts.push_name END,
        phone_number = CASE WHEN excluded.phone_number != '' THEN excluded.phone_number ELSE contacts.phone_number END,
        is_group = excluded.is_group
    `)

    for (const contact of waContacts) {
      if (!(contact.isMyContact || contact.isGroup)) continue
      const waId = this.toIdString(contact.id)
      if (!waId || this.isSystemChat(waId)) continue
      try {
        upsertContact.run(
          accountId, waId,
          contact.name || '', contact.pushname || '', contact.number || '',
          contact.isGroup ? 1 : 0
        )
      } catch (err) {
        console.error('[WA] upsertContact error:', err.message)
      }
    }
    this.safeSend('wa:contacts-synced', accountId)
    this.safeSend('wa:contacts-updated', { accountId })
  }

  // ---------- handle messaggio (incoming/outgoing/sync) ----------

  async handleIncomingMessage(accountId, msg, opts = {}) {
    const incrementUnread = opts.incrementUnread !== false
    const downloadMedia = opts.downloadMedia === true

    if (!msg?.id?.id) return
    const existing = this.db.prepare('SELECT id FROM messages WHERE account_id = ? AND wa_message_id = ?')
      .get(accountId, msg.id.id)
    if (existing) return

    // Risolvi chat (single source of truth per whatsapp_id)
    let chatWaId, chatName = '', chatIsGroup = 0
    try {
      const chat = await msg.getChat()
      chatWaId = this.toIdString(chat.id)
      chatName = chat.name || ''
      chatIsGroup = chat.isGroup ? 1 : 0
    } catch (err) {
      const fallback = msg.fromMe ? msg.to : msg.from
      chatWaId = this.toIdString(fallback)
    }
    if (!chatWaId) return
    // Ignora completamente status broadcast e liste broadcast
    if (this.isSystemChat(chatWaId)) return

    let contact = this.db.prepare('SELECT id, is_group FROM contacts WHERE account_id = ? AND whatsapp_id = ?')
      .get(accountId, chatWaId)

    if (!contact) {
      try {
        this.db.prepare('INSERT OR IGNORE INTO contacts (account_id, whatsapp_id, name, is_group) VALUES (?, ?, ?, ?)')
          .run(accountId, chatWaId, chatName, chatIsGroup)
        contact = this.db.prepare('SELECT id, is_group FROM contacts WHERE account_id = ? AND whatsapp_id = ?')
          .get(accountId, chatWaId)
      } catch (err) {
        console.error('[WA] insert contact:', err.message)
      }
    }
    if (!contact) return

    const timestamp = new Date(msg.timestamp * 1000).toISOString()

    // Media: durante sync NON scarichiamo, salviamo solo il flag.
    // L'on-demand handler `wa:downloadMedia` farà il fetch quando il renderer apre il messaggio.
    let mediaPath = null, mediaMime = null, mediaFilename = null
    if (msg.hasMedia && downloadMedia) {
      const saved = await this.downloadAndSaveMedia(accountId, msg)
      if (saved) {
        mediaPath = saved.path
        mediaMime = saved.mime
        mediaFilename = saved.filename
      }
    }

    // Sender name nei gruppi (robusto: authorId può essere oggetto)
    let senderName = null
    if (contact.is_group && !msg.fromMe) {
      const rawAuthor = msg.author || msg.id?.participant || msg._data?.author || msg._data?.participant
      const authorId = this.toIdString(rawAuthor)
      if (authorId) {
        try {
          const client = this.clients.get(accountId)
          if (client) {
            const senderContact = await client.getContactById(authorId)
            senderName = senderContact?.pushname || senderContact?.name || senderContact?.number || authorId.split('@')[0]
          }
        } catch {
          senderName = authorId.split('@')[0]
        }
      } else {
        senderName = 'Sconosciuto'
      }
    }

    // Estrai metadati media (durata audio/video, dimensione, eventuale thumbnail base64)
    let mediaDuration = null, mediaSize = null, mediaWidth = null, mediaHeight = null, mediaThumb = null
    if (msg.hasMedia) {
      const data = msg._data || {}
      mediaDuration = (typeof data.duration === 'number') ? Math.round(data.duration) : null
      mediaSize = data.size || data.fileSize || null
      mediaWidth = data.width || null
      mediaHeight = data.height || null
      // Per immagini/video WhatsApp include una micro-thumbnail base64 (~5-10kb).
      // ATTENZIONE: per video con caption, _data.body è il caption testuale, non la thumb.
      // Validiamo: deve iniziare coi byte magici JPEG (`/9j/`) o PNG (`iVBORw0`).
      const mt = (msg.type || '').toLowerCase()
      if (mt === 'image' || mt === 'video' || mt === 'sticker') {
        const candidate = typeof data.body === 'string' && data.body.length > 100 && data.body.length < 80_000
          ? data.body
          : null
        if (candidate && (candidate.startsWith('/9j/') || candidate.startsWith('iVBORw0'))) {
          const isJpeg = candidate.startsWith('/9j/')
          mediaThumb = `data:image/${isJpeg ? 'jpeg' : 'png'};base64,${candidate}`
        }
      }
    }

    let result
    try {
      result = this.db.prepare(`
        INSERT INTO messages (account_id, contact_id, wa_message_id, wa_serialized_id, body, media_type, media_path, media_mime, media_filename, media_thumb, media_duration, media_size, media_width, media_height, is_from_me, timestamp, status, sender_name, ack)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        accountId, contact.id, msg.id.id, msg.id._serialized || null,
        msg.body || '',
        msg.hasMedia ? msg.type : 'text',
        mediaPath, mediaMime, mediaFilename,
        mediaThumb, mediaDuration, mediaSize, mediaWidth, mediaHeight,
        msg.fromMe ? 1 : 0, timestamp, 'received', senderName,
        msg.ack != null ? msg.ack : 0
      )
    } catch (err) {
      // Race su UNIQUE: ignora silenziosamente
      if (!String(err.message).includes('UNIQUE')) console.error('[WA] insert message:', err.message)
      return
    }

    this.db.prepare(`
      UPDATE contacts SET
        last_message_at = ?,
        unread_count = CASE WHEN ? = 0 AND ? = 1 THEN unread_count + 1 ELSE unread_count END
      WHERE id = ?
    `).run(timestamp, msg.fromMe ? 1 : 0, incrementUnread ? 1 : 0, contact.id)

    this.safeSend('wa:message', {
      accountId,
      message: {
        id: result.lastInsertRowid,
        account_id: accountId,
        contact_id: contact.id,
        wa_message_id: msg.id.id,
        wa_serialized_id: msg.id._serialized || null,
        body: msg.body || '',
        is_from_me: msg.fromMe ? 1 : 0,
        timestamp,
        media_type: msg.hasMedia ? msg.type : 'text',
        media_path: mediaPath,
        media_mime: mediaMime,
        media_filename: mediaFilename,
        media_thumb: mediaThumb,
        media_duration: mediaDuration,
        media_size: mediaSize,
        media_width: mediaWidth,
        media_height: mediaHeight,
        sender_name: senderName,
        status: 'received',
        ack: msg.ack != null ? msg.ack : 0
      }
    })

    // Fetch avatar se il contatto non ce l'ha ancora (fire-and-forget)
    const hasAvatar = this.db.prepare('SELECT profile_pic_url FROM contacts WHERE id = ?').get(contact.id)
    if (!hasAvatar?.profile_pic_url) {
      const client = this.clients.get(accountId)
      if (client) {
        client.getContactById(chatWaId).then(async waContact => {
          const url = await waContact?.getProfilePicUrl()
          if (url) {
            this.db.prepare('UPDATE contacts SET profile_pic_url = ? WHERE id = ?').run(url, contact.id)
            this.safeSend('wa:contacts-updated', { accountId })
          }
        }).catch(() => {})
      }
    }
  }

  // Verifica che un Buffer sia un'immagine vera (JPEG/PNG/WEBP/GIF magic bytes)
  isValidImageBuffer(buf) {
    if (!buf || buf.length < 8) return false
    // JPEG: FF D8 FF
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true
    // GIF: 47 49 46 38
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true
    // WEBP: "RIFF...WEBP"
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
        && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true
    return false
  }

  isValidImageFile(filePath) {
    try {
      const fd = fs.openSync(filePath, 'r')
      const buf = Buffer.alloc(12)
      fs.readSync(fd, buf, 0, 12, 0)
      fs.closeSync(fd)
      return this.isValidImageBuffer(buf)
    } catch { return false }
  }

  async downloadAndSaveMedia(accountId, msg) {
    try {
      const media = await msg.downloadMedia()
      if (!media) return null
      const mediaDir = path.join(app.getPath('userData'), 'media', accountId.toString())
      if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true })
      const ext = (media.mimetype.split('/')[1] || 'bin').split(';')[0]
      const filename = `${msg.id.id}.${ext}`
      const fullPath = path.join(mediaDir, filename)
      fs.writeFileSync(fullPath, media.data, 'base64')
      const stat = fs.statSync(fullPath)
      return { path: fullPath, mime: media.mimetype, filename: media.filename || filename, size: stat.size }
    } catch (err) {
      console.error('[WA] media download error:', err.message)
      return null
    }
  }
}

module.exports = { WhatsAppManager }

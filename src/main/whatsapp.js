const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js')
const { app, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const schedule = require('node-schedule')

class WhatsAppManager {
  constructor(db, mainWindow) {
    this.db = db
    this.mainWindow = mainWindow
    this.clients = new Map() // accountId -> Client instance
    this.scheduledTasks = new Map() // scheduledMessageId -> job
    this.initHandlers()
    this.loadScheduledMessages()
    this.autoInitializeAccounts()
  }

  async autoInitializeAccounts() {
    const activeAccounts = this.db.prepare("SELECT id FROM accounts WHERE phone_number IS NOT NULL AND phone_number != ''").all()
    for (const acc of activeAccounts) {
      this.initializeClient(acc.id).catch(err => console.error(`Failed to auto-init account ${acc.id}:`, err))
    }
  }

  initHandlers() {
    // Segna come letto
    ipcMain.handle('wa:markAsRead', async (_, accountId, contactId) => {
      const client = this.clients.get(accountId)
      if (!client || !client.pupPage) return
      
      const contact = this.db.prepare('SELECT whatsapp_id FROM contacts WHERE id = ?').get(contactId)
      if (contact) {
        try {
          const chat = await client.getChatById(contact.whatsapp_id)
          if (chat) {
            await chat.sendSeen()
            this.db.prepare('UPDATE contacts SET unread_count = 0 WHERE id = ?').run(contactId)
            this.mainWindow.webContents.send('wa:contacts-updated', accountId)
          }
        } catch (err) { console.error('Error marking as read:', err) }
      }
    })

    ipcMain.handle('wa:markAllAsRead', async (_, accountId) => {
      this.db.prepare('UPDATE contacts SET unread_count = 0 WHERE account_id = ?').run(accountId)
      this.mainWindow.webContents.send('wa:contacts-updated', accountId)
      return true
    })

    ipcMain.handle('wa:resetHistory', async (_, accountId) => {
      try {
        const client = this.clients.get(accountId)
        if (!client) throw new Error('WhatsApp non connesso')
        
        this.db.prepare('DELETE FROM messages WHERE account_id = ?').run(accountId)
        this.db.prepare('UPDATE contacts SET last_message_at = NULL, unread_count = 0 WHERE account_id = ?').run(accountId)
        
        await this.syncRecentHistory(accountId, client)
        return { success: true }
      } catch (err) {
        console.error('Reset history error:', err)
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
          await this.handleIncomingMessage(accountId, msg, false)
        }
        
        this.mainWindow.webContents.send('wa:history-synced', { accountId })
        return { success: true }
      } catch (err) {
        console.error('Sync chat history error:', err)
        return { success: false, error: err.message }
      }
    })

    // Avvia il client per un account specifico
    ipcMain.handle('wa:initialize', async (_, accountId) => {
      return this.initializeClient(accountId)
    })

    // Invia un messaggio
    ipcMain.handle('wa:sendMessage', async (_, accountId, contactId, body, options = {}) => {
      const client = this.clients.get(accountId)
      if (!client) throw new Error('WhatsApp non è ancora connesso. Attendi qualche istante.')
      
      try {
        const contact = this.db.prepare('SELECT whatsapp_id FROM contacts WHERE id = ?').get(contactId)
        if (!contact) throw new Error('Contatto non trovato nel database locale')

        console.log(`[WA] Sending message to ${contact.whatsapp_id}...`)
        const msg = await client.sendMessage(contact.whatsapp_id, body, options)
        
        // Forza l'inserimento immediato nel DB per feedback istantaneo
        await this.handleIncomingMessage(accountId, msg)
        
        return { id: msg.id.id, timestamp: msg.timestamp }
      } catch (err) {
        console.error(`[WA] Send Error:`, err)
        throw err
      }
    })

    ipcMain.handle('wa:destroy', async (_, accountId) => {
      return this.destroyClient(accountId)
    })
  }

  async destroyClient(accountId) {
    const client = this.clients.get(accountId)
    if (client) {
      try {
        await client.destroy()
      } catch (err) {
        console.error(`Error destroying client ${accountId}:`, err)
      }
      this.clients.delete(accountId)
    }
    return true
  }

  // Carica i messaggi programmati dal DB all'avvio
  loadScheduledMessages() {
    const messages = this.db.prepare('SELECT * FROM scheduled_messages WHERE is_active = 1').all()
    messages.forEach(msg => {
      const targetTime = new Date(msg.next_send_at || msg.scheduled_at)
      if (targetTime > new Date()) {
        this.scheduleMessage(msg)
      }
    })
  }

  scheduleMessage(msg) {
    // Cancella task esistente se presente
    if (this.scheduledTasks.has(msg.id)) {
      this.scheduledTasks.get(msg.id).cancel()
    }

    const job = schedule.scheduleJob(new Date(msg.next_send_at || msg.scheduled_at), async () => {
      await this.sendScheduledMessage(msg)
    })
    
    if (job) {
      this.scheduledTasks.set(msg.id, job)
    }
  }

  async sendScheduledMessage(msg) {
    const client = this.clients.get(msg.account_id)
    if (!client) {
      console.error(`Client ${msg.account_id} non pronto per messaggio programmato ${msg.id}`)
      return
    }

    try {
      let targets = []
      if (msg.target_type === 'contact' || msg.target_type === 'group') {
        const contact = this.db.prepare('SELECT whatsapp_id FROM contacts WHERE id = ?').get(msg.target_id)
        if (contact) targets.push(contact.whatsapp_id)
      } else if (msg.target_type === 'folder') {
        const members = this.db.prepare('SELECT c.whatsapp_id FROM contacts c JOIN folder_members fm ON fm.contact_id = c.id WHERE fm.folder_id = ?').all(msg.target_id)
        targets = members.map(m => m.whatsapp_id)
      }

      for (const waId of targets) {
        await client.sendMessage(waId, msg.body)
      }

      // Aggiorna stato nel DB
      this.db.prepare("UPDATE scheduled_messages SET last_sent_at = datetime('now') WHERE id = ?").run(msg.id)
      
      // Gestione ricorrenza (semplificata)
      if (msg.recurrence_type !== 'once') {
        const nextTime = this.calculateNextTime(msg.next_send_at || msg.scheduled_at, msg.recurrence_type)
        this.db.prepare('UPDATE scheduled_messages SET next_send_at = ? WHERE id = ?').run(nextTime.toISOString(), msg.id)
        this.scheduleMessage({ ...msg, next_send_at: nextTime.toISOString() })
      } else {
        this.db.prepare('UPDATE scheduled_messages SET is_active = 0 WHERE id = ?').run(msg.id)
        this.scheduledTasks.delete(msg.id)
      }

      this.mainWindow.webContents.send('scheduled:updated')
    } catch (err) {
      console.error(`Errore invio messaggio programmato ${msg.id}:`, err)
    }
  }

  calculateNextTime(lastTime, recurrence) {
    const date = new Date(lastTime)
    switch (recurrence) {
      case 'daily': date.setDate(date.getDate() + 1); break
      case 'weekly': date.setDate(date.getDate() + 7); break
      case 'monthly': date.setMonth(date.getMonth() + 1); break
    }
    return date
  }

  async initializeClient(accountId) {
    if (this.clients.has(accountId)) return true

    const account = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
    if (!account) return false

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: `account-${accountId}`,
        dataPath: path.join(app.getPath('userData'), 'sessions')
      }),
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
      },
      puppeteer: {
        headless: true, // Pairing completato, torniamo in background
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-extensions',
          '--no-first-run',
          '--no-zygote',
          '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ],
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false
      }
    })

    client.on('qr', (qr) => {
      console.log(`[WA] QR Code received for account ${accountId}`)
      this.mainWindow.webContents.send('wa:qr', { accountId, qr })
    })

    client.on('loading_screen', (percent, message) => {
      console.log(`[WA] Loading: ${percent}% - ${message}`)
      this.mainWindow.webContents.send('wa:loading', { accountId, percent, message })
    })

    client.on('ready', async () => {
      const info = client.info
      this.db.prepare('UPDATE accounts SET phone_number = ?, name = ?, is_active = 1 WHERE id = ?')
        .run(info.wid.user, info.pushname || '', accountId)
      
      this.mainWindow.webContents.send('wa:ready', { accountId, info })
      
      // Priorità allo storico recente per mostrare subito qualcosa all'utente
      this.syncRecentHistory(accountId, client).then(() => {
        this.syncContacts(accountId, client)
      }).catch(err => console.error('Sync error:', err))
    })

    client.on('message', async (msg) => {
      await this.handleIncomingMessage(accountId, msg)
    })

    client.on('message_create', async (msg) => {
      if (msg.fromMe) {
        await this.handleIncomingMessage(accountId, msg)
      }
    })

    client.on('disconnected', (reason) => {
      this.db.prepare('UPDATE accounts SET is_active = 0 WHERE id = ?').run(accountId)
      this.mainWindow.webContents.send('wa:disconnected', { accountId, reason })
      this.clients.delete(accountId)
    })

    this.clients.set(accountId, client)
    
    try {
      console.log(`[WA] Starting initialization for account ${accountId}...`)
      await client.initialize()
    } catch (err) {
      console.error(`[WA] Critical error during initialization of account ${accountId}:`, err)
      this.mainWindow.webContents.send('wa:error', { accountId, error: err.message })
    }
    
    return true
  }

  async syncContacts(accountId, client) {
    const waContacts = await client.getContacts()
    const upsertContact = this.db.prepare(`
      INSERT INTO contacts (account_id, whatsapp_id, name, push_name, phone_number, profile_pic_path, is_group)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, whatsapp_id) DO UPDATE SET
      name=excluded.name, push_name=excluded.push_name, phone_number=excluded.phone_number,
      profile_pic_path=COALESCE(excluded.profile_pic_path, contacts.profile_pic_path),
      is_group=excluded.is_group
    `)

    for (const contact of waContacts) {
      if (contact.isMyContact || contact.isGroup) {
        let localAvatarPath = null
        try { 
          const url = await contact.getProfilePicUrl() 
          if (url) {
            // Scarica avatar se non lo abbiamo o è cambiato
            const avatarDir = path.join(app.getPath('userData'), 'avatars')
            if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true })
            const filename = `${contact.id._serialized.replace(/[^a-zA-Z0-9]/g, '_')}.jpg`
            localAvatarPath = path.join(avatarDir, filename)
            
            // Per ora lo scarichiamo sempre o potremmo ottimizzare
            const response = await fetch(url)
            const buffer = await response.arrayBuffer()
            fs.writeFileSync(localAvatarPath, Buffer.from(buffer))
          }
        } catch {}

        upsertContact.run(
          accountId,
          contact.id._serialized,
          contact.name || '',
          contact.pushname || '',
          contact.number || '',
          localAvatarPath,
          contact.isGroup ? 1 : 0
        )
      }
    }
    
    this.mainWindow.webContents.send('wa:contacts-synced', accountId)
  }

  async syncRecentHistory(accountId, client) {
    console.log(`[WA] Syncing recent history for account ${accountId}...`)
    const chats = await client.getChats()
    // Prendi le ultime 100 chat attive
    const recentChats = chats.slice(0, 100)
    
    for (const chat of recentChats) {
      try {
        // Sincronizza il conteggio non letti reale di WhatsApp
        this.db.prepare('UPDATE contacts SET unread_count = ? WHERE account_id = ? AND whatsapp_id = ?')
          .run(chat.unreadCount || 0, accountId, chat.id._serialized)

        const messages = await chat.fetchMessages({ limit: 150 })
        for (const msg of messages) {
          await this.handleIncomingMessage(accountId, msg, false) // false = non incrementare badge durante sync
        }
      } catch (err) {
        console.error(`Error fetching messages for chat ${chat.id._serialized}:`, err)
      }
    }
    console.log(`[WA] History sync complete for account ${accountId}`)
    this.mainWindow.webContents.send('wa:history-synced', accountId)
  }

  async handleIncomingMessage(accountId, msg, shouldIncrementUnread = true) {
    // Evita duplicati basandosi sull'ID di WhatsApp
    const existing = this.db.prepare('SELECT id FROM messages WHERE wa_message_id = ?').get(msg.id.id)
    if (existing) return

    // Trova o crea contatto nel DB
    const contactWaId = msg.fromMe ? msg.to : msg.from
    let contact = this.db.prepare('SELECT id, is_group FROM contacts WHERE account_id = ? AND whatsapp_id = ?')
      .get(accountId, contactWaId)

    if (!contact) {
      try {
        const chat = await msg.getChat()
        this.db.prepare(`
          INSERT OR IGNORE INTO contacts (account_id, whatsapp_id, name, is_group)
          VALUES (?, ?, ?, ?)
        `).run(accountId, chat.id._serialized, chat.name || '', chat.isGroup ? 1 : 0)
        
        contact = this.db.prepare('SELECT id, is_group FROM contacts WHERE account_id = ? AND whatsapp_id = ?')
          .get(accountId, contactWaId)
      } catch (err) {
        console.error('Error creating contact from message:', err)
        return
      }
    }

    if (!contact) return

    // Inserisci messaggio
    const timestamp = new Date(msg.timestamp * 1000).toISOString()
    let mediaPath = null
    let mediaMime = null
    let mediaFilename = null

    if (msg.hasMedia) {
      try {
        const media = await msg.downloadMedia()
        if (media) {
          const mediaDir = path.join(app.getPath('userData'), 'media', accountId.toString())
          if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true })
          
          const filename = `${msg.id.id}.${media.mimetype.split('/')[1].split(';')[0]}`
          mediaPath = path.join(mediaDir, filename)
          fs.writeFileSync(mediaPath, media.data, 'base64')
          mediaMime = media.mimetype
          mediaFilename = media.filename || filename
        }
      } catch (err) {
        console.error('[WA] Media download error:', err)
      }
    }

    // Ottieni il nome del mittente reale se in un gruppo
    let senderName = null
    if (contact.is_group && !msg.fromMe) {
      const authorId = msg.author || (msg.id && msg.id.participant) || (msg._data && msg._data.author) || (msg._data && msg._data.participant)
      if (authorId) {
        try {
          const client = this.clients.get(accountId)
          if (client) {
            const senderContact = await client.getContactById(authorId)
            senderName = senderContact.pushname || senderContact.name || senderContact.number || authorId.split('@')[0]
          }
        } catch (e) {
          console.error('Error fetching group sender:', e)
          senderName = authorId.split('@')[0]
        }
      } else {
        senderName = 'Sconosciuto'
      }
    }

    const msgData = {
      account_id: accountId,
      contact_id: contact.id,
      wa_message_id: msg.id.id,
      body: msg.body || '',
      is_from_me: msg.fromMe ? 1 : 0,
      timestamp: timestamp,
      media_type: msg.hasMedia ? msg.type : 'text',
      media_path: mediaPath,
      media_mime: mediaMime,
      media_filename: mediaFilename,
      sender_name: senderName,
      status: 'received'
    }

    const result = this.db.prepare(`
      INSERT INTO messages (account_id, contact_id, wa_message_id, body, media_type, media_path, media_mime, media_filename, is_from_me, timestamp, status, sender_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msgData.account_id, msgData.contact_id, msgData.wa_message_id,
      msgData.body, msgData.media_type, msgData.media_path, msgData.media_mime, msgData.media_filename,
      msgData.is_from_me, msgData.timestamp, msgData.status, msgData.sender_name
    )

    // Aggiorna metadati contatto (ultimo messaggio, ora, contatore non letti)
    this.db.prepare(`
      UPDATE contacts SET 
      last_message_at = ?, 
      unread_count = CASE WHEN ? = 0 AND ? = 1 THEN unread_count + 1 ELSE unread_count END
      WHERE id = ?
    `).run(timestamp, msgData.is_from_me, shouldIncrementUnread ? 1 : 0, contact.id)

    this.mainWindow.webContents.send('wa:message', {
      accountId,
      message: { ...msgData, id: result.lastInsertRowid }
    })
  }
}

module.exports = { WhatsAppManager }

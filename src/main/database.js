const Database = require('better-sqlite3')
const path = require('path')
const { app } = require('electron')

let db = null

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'mich-enger.db')
  db = new Database(dbPath)

  // Abilita WAL mode per performance
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')

  createTables()
  
  // Aggiungi colonne mancanti se necessario
  try { db.prepare('ALTER TABLE messages ADD COLUMN sender_name TEXT').run() } catch (e) {}
  try { db.prepare('ALTER TABLE tasks ADD COLUMN recurrence_type TEXT DEFAULT "once"').run() } catch (e) {}
  try { db.prepare('ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT').run() } catch (e) {}
  // Metadati media (popolati dal sync, usati dal renderer per placeholder stile WA Web)
  try { db.prepare('ALTER TABLE messages ADD COLUMN wa_serialized_id TEXT').run() } catch (e) {}
  try { db.prepare('ALTER TABLE messages ADD COLUMN media_thumb TEXT').run() } catch (e) {}        // base64 dataURL low-res
  try { db.prepare('ALTER TABLE contacts ADD COLUMN profile_pic_url TEXT').run() } catch (e) {}
  try { db.prepare('ALTER TABLE messages ADD COLUMN media_duration INTEGER').run() } catch (e) {} // secondi (audio/video)
  try { db.prepare('ALTER TABLE messages ADD COLUMN media_size INTEGER').run() } catch (e) {}    // byte
  try { db.prepare('ALTER TABLE messages ADD COLUMN media_width INTEGER').run() } catch (e) {}
  try { db.prepare('ALTER TABLE messages ADD COLUMN media_height INTEGER').run() } catch (e) {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_messages_serialized ON messages(wa_serialized_id)').run() } catch (e) {}
  try { db.prepare('ALTER TABLE messages ADD COLUMN wa_raw_message TEXT').run() } catch (e) {}
  try {
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_wa_id ON messages(account_id, wa_message_id) WHERE wa_message_id IS NOT NULL').run()
  } catch (e) {}
  try { db.prepare('ALTER TABLE messages ADD COLUMN ack INTEGER DEFAULT 0').run() } catch (e) {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS message_reactions (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        message_db_id         INTEGER NOT NULL,
        wa_message_serialized TEXT NOT NULL,
        emoji                 TEXT NOT NULL,
        sender_wa_id          TEXT NOT NULL,
        sender_name           TEXT DEFAULT '',
        reacted_at            TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (message_db_id) REFERENCES messages(id) ON DELETE CASCADE,
        UNIQUE(wa_message_serialized, sender_wa_id)
      )
    `)
    db.prepare('CREATE INDEX IF NOT EXISTS idx_reactions_msg ON message_reactions(message_db_id)').run()
  } catch (e) {}

  return db
}

function createTables() {
  db.exec(`
    -- Account WhatsApp (multi-account)
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone_number TEXT,
      name TEXT DEFAULT '',
      session_data TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Contatti sincronizzati da WhatsApp
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      whatsapp_id TEXT NOT NULL,
      name TEXT DEFAULT '',
      push_name TEXT DEFAULT '',
      phone_number TEXT DEFAULT '',
      profile_pic_path TEXT,
      profile_pic_url TEXT,
      is_group INTEGER DEFAULT 0,
      is_muted INTEGER DEFAULT 0,
      unread_count INTEGER DEFAULT 0,
      last_message_at TEXT,
      last_synced_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      UNIQUE(account_id, whatsapp_id)
    );

    -- Cartelle utente (nesting illimitato)
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      color TEXT DEFAULT '#8b6f47',
      icon TEXT DEFAULT 'folder',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
    );

    -- Associazione contatti-cartelle (many-to-many)
    CREATE TABLE IF NOT EXISTS folder_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
      UNIQUE(folder_id, contact_id)
    );

    -- Messaggi (storico WhatsApp)
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      wa_message_id TEXT,
      body TEXT DEFAULT '',
      media_type TEXT DEFAULT 'text',
      media_path TEXT,
      media_mime TEXT,
      media_filename TEXT,
      is_from_me INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL,
      status TEXT DEFAULT 'sent',
      is_starred INTEGER DEFAULT 0,
      quoted_message_id INTEGER,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
    );

    -- Messaggi programmati
    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('contact', 'folder', 'group')),
      target_id INTEGER NOT NULL,
      target_name TEXT DEFAULT '',
      body TEXT DEFAULT '',
      media_type TEXT DEFAULT 'text',
      media_path TEXT,
      scheduled_at TEXT,
      recurrence_type TEXT DEFAULT 'once' CHECK(recurrence_type IN ('once', 'daily', 'weekly', 'monthly', 'custom')),
      recurrence_rule TEXT,
      is_active INTEGER DEFAULT 1,
      last_sent_at TEXT,
      next_send_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    -- Task / To-Do
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done', 'archived')),
      priority TEXT CHECK(priority IN (NULL, 'low', 'medium', 'high')),
      due_date TEXT,
      source_message_id INTEGER,
      notify INTEGER DEFAULT 0,
      notify_at TEXT,
      recurrence_type TEXT DEFAULT 'once' CHECK(recurrence_type IN ('once', 'daily', 'weekly', 'monthly')),
      recurrence_rule TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE SET NULL
    );

    -- Etichette task
    CREATE TABLE IF NOT EXISTS task_labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#8b6f47'
    );

    -- Associazione task-etichette
    CREATE TABLE IF NOT EXISTS task_label_map (
      task_id INTEGER NOT NULL,
      label_id INTEGER NOT NULL,
      PRIMARY KEY (task_id, label_id),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (label_id) REFERENCES task_labels(id) ON DELETE CASCADE
    );

    -- Impostazioni utente
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Indici per performance
    CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account_id);
    CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_folder_members_folder ON folder_members(folder_id);
    CREATE INDEX IF NOT EXISTS idx_folder_members_contact ON folder_members(contact_id);
    CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
    CREATE INDEX IF NOT EXISTS idx_scheduled_next ON scheduled_messages(next_send_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  `)

  // Migrazione: aggiunge colonne introdotte dopo la creazione iniziale dello schema
  try { db.exec("ALTER TABLE scheduled_messages ADD COLUMN mentions_json TEXT DEFAULT NULL") } catch (_) {}

  // Inserisci impostazioni di default se non esistono
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
  insertSetting.run('theme', 'dark')
  insertSetting.run('language', 'it')
  insertSetting.run('media_path', '')
  insertSetting.run('notifications_enabled', 'true')
}

function getDatabase() {
  return db
}

/**
 * Rimuove i contatti "di sistema" finiti per errore nel DB:
 *  - status@broadcast (gli stati di tutti)
 *  - liste broadcast generiche
 *  - 0@c.us (notifiche WhatsApp)
 * Cancella anche i loro messaggi e folder_members associati (CASCADE).
 */
function cleanSystemContacts() {
  if (!db) return { removed: 0 }
  const result = db.prepare(`
    DELETE FROM contacts
    WHERE whatsapp_id = 'status@broadcast'
       OR whatsapp_id = '0@c.us'
       OR whatsapp_id = '0@s.whatsapp.net'
       OR whatsapp_id LIKE '%@broadcast'
  `).run()
  return { removed: result.changes }
}

/**
 * Unifica i contatti duplicati (stesso account_id + stesso phone_number, oppure
 * stesso account_id + whatsapp_id che differiscono solo per il suffisso dominio
 * — capita con @c.us vs @lid). Tiene il record più "ricco" (più messaggi) e
 * sposta i messaggi/folder_members degli altri sul vincente.
 */
function dedupeContacts() {
  if (!db) return { merged: 0 }
  let merged = 0

  const groups = db.prepare(`
    SELECT account_id, phone_number, GROUP_CONCAT(id) as ids, COUNT(*) as cnt
    FROM contacts
    WHERE phone_number IS NOT NULL AND phone_number != '' AND is_group = 0
    GROUP BY account_id, phone_number
    HAVING cnt > 1
  `).all()

  const txn = db.transaction((dupGroups) => {
    for (const g of dupGroups) {
      const ids = g.ids.split(',').map(Number)
      // winner = quello con più messaggi
      const ranked = ids.map(id => ({
        id,
        msgs: db.prepare('SELECT COUNT(*) as c FROM messages WHERE contact_id = ?').get(id).c
      })).sort((a, b) => b.msgs - a.msgs)
      const winner = ranked[0].id
      const losers = ranked.slice(1).map(r => r.id)
      for (const loser of losers) {
        db.prepare('UPDATE messages SET contact_id = ? WHERE contact_id = ?').run(winner, loser)
        db.prepare('UPDATE OR IGNORE folder_members SET contact_id = ? WHERE contact_id = ?').run(winner, loser)
        db.prepare('DELETE FROM folder_members WHERE contact_id = ?').run(loser)
        db.prepare('DELETE FROM contacts WHERE id = ?').run(loser)
        merged++
      }
    }
  })
  txn(groups)
  return { merged }
}

function updateMessageAck(waSerializedId, ack) {
  if (!db) return
  db.prepare('UPDATE messages SET ack = ? WHERE wa_serialized_id = ?').run(ack, waSerializedId)
}

function upsertReaction(waSerializedId, emoji, senderWaId, senderName, reactedAt, messageDbId) {
  if (!db) return
  db.prepare(`
    INSERT INTO message_reactions (message_db_id, wa_message_serialized, emoji, sender_wa_id, sender_name, reacted_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(wa_message_serialized, sender_wa_id) DO UPDATE SET
      emoji = excluded.emoji, reacted_at = excluded.reacted_at
  `).run(messageDbId, waSerializedId, emoji, senderWaId, senderName || '', reactedAt || new Date().toISOString())
}

function deleteReaction(waSerializedId, senderWaId) {
  if (!db) return
  db.prepare('DELETE FROM message_reactions WHERE wa_message_serialized = ? AND sender_wa_id = ?')
    .run(waSerializedId, senderWaId)
}

function getReactionsByContact(contactId) {
  if (!db) return []
  return db.prepare(`
    SELECT r.*, m.wa_serialized_id
    FROM message_reactions r
    JOIN messages m ON m.id = r.message_db_id
    WHERE m.contact_id = ?
    ORDER BY r.reacted_at ASC
  `).all(contactId)
}

module.exports = { initDatabase, getDatabase, dedupeContacts, cleanSystemContacts, updateMessageAck, upsertReaction, deleteReaction, getReactionsByContact }

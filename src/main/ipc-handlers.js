const { ipcMain, shell } = require('electron')
const { dedupeContacts } = require('./database')

function registerIpcHandlers(db, waManager, scheduler, notificationManager) {
  // SETTINGS
  ipcMain.handle('settings:get', (_, key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
    return row ? row.value : null
  })
  ipcMain.handle('settings:set', (_, key, value) => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
    return true
  })
  ipcMain.handle('settings:getAll', () => {
    const rows = db.prepare('SELECT * FROM settings').all()
    const settings = {}
    rows.forEach(r => { settings[r.key] = r.value })
    return settings
  })

  // ACCOUNTS
  ipcMain.handle('accounts:getAll', () => {
    return db.prepare('SELECT * FROM accounts ORDER BY created_at').all()
  })
  ipcMain.handle('accounts:create', (_, data) => {
    const result = db.prepare('INSERT INTO accounts (name, phone_number) VALUES (?, ?)').run(data.name || '', data.phone_number || '')
    return { id: result.lastInsertRowid }
  })
  ipcMain.handle('accounts:update', (_, id, data) => {
    const fields = [], values = []
    Object.entries(data).forEach(([k, v]) => { if (k !== 'id') { fields.push(`${k} = ?`); values.push(v) } })
    values.push(id)
    db.prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return true
  })
  ipcMain.handle('accounts:delete', (_, id) => {
    db.prepare('DELETE FROM accounts WHERE id = ?').run(id)
    return true
  })

  // CONTACTS
  ipcMain.handle('contacts:getAll', (_, accountId) => {
    return db.prepare(`
      SELECT c.*,
      (SELECT body FROM messages WHERE contact_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message_body
      FROM contacts c
      WHERE c.account_id = ? AND c.is_group = 0
        AND c.whatsapp_id NOT IN ('status@broadcast', '0@c.us')
        AND c.whatsapp_id NOT LIKE '%@broadcast'
      ORDER BY last_message_at DESC, name ASC
    `).all(accountId)
  })
  ipcMain.handle('contacts:getGroups', (_, accountId) => {
    return db.prepare(`
      SELECT c.*,
      (SELECT body FROM messages WHERE contact_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message_body
      FROM contacts c
      WHERE c.account_id = ? AND c.is_group = 1
        AND c.whatsapp_id NOT IN ('status@broadcast', '0@c.us')
        AND c.whatsapp_id NOT LIKE '%@broadcast'
      ORDER BY last_message_at DESC, name ASC
    `).all(accountId)
  })
  ipcMain.handle('contacts:search', (_, accountId, query) => {
    return db.prepare('SELECT * FROM contacts WHERE account_id = ? AND (name LIKE ? OR push_name LIKE ? OR phone_number LIKE ?) ORDER BY name LIMIT 10')
      .all(accountId, `%${query}%`, `%${query}%`, `%${query}%`)
  })
  ipcMain.handle('contacts:upsert', (_, data) => {
    const result = db.prepare(`INSERT INTO contacts (account_id, whatsapp_id, name, push_name, phone_number, profile_pic_path, profile_pic_url, is_group)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, whatsapp_id) DO UPDATE SET
      name=excluded.name, push_name=excluded.push_name, phone_number=excluded.phone_number,
      profile_pic_path=excluded.profile_pic_path, profile_pic_url=excluded.profile_pic_url, last_synced_at=datetime('now')`)
      .run(data.account_id, data.whatsapp_id, data.name || '', data.push_name || '', data.phone_number || '', data.profile_pic_path || null, data.profile_pic_url || null, data.is_group ? 1 : 0)
    return { id: result.lastInsertRowid }
  })
  ipcMain.handle('contacts:updateUnread', (_, contactId, count) => {
    db.prepare('UPDATE contacts SET unread_count = ? WHERE id = ?').run(count, contactId)
    return true
  })

  // FOLDERS
  ipcMain.handle('folders:getAll', () => {
    return db.prepare('SELECT * FROM folders ORDER BY sort_order, name').all()
  })
  ipcMain.handle('folders:create', (_, data) => {
    const result = db.prepare('INSERT INTO folders (name, parent_id, color, icon, sort_order) VALUES (?, ?, ?, ?, ?)')
      .run(data.name, data.parent_id || null, data.color || '#6C3CE1', data.icon || 'folder', data.sort_order || 0)
    return { id: result.lastInsertRowid }
  })
  ipcMain.handle('folders:update', (_, id, data) => {
    const fields = [], values = []
    Object.entries(data).forEach(([k, v]) => { if (k !== 'id') { fields.push(`${k} = ?`); values.push(v) } })
    values.push(id)
    db.prepare(`UPDATE folders SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return true
  })
  ipcMain.handle('folders:delete', (_, id) => {
    db.prepare('DELETE FROM folders WHERE id = ?').run(id)
    return true
  })
  ipcMain.handle('folders:getMembers', (_, folderId) => {
    return db.prepare('SELECT c.* FROM contacts c JOIN folder_members fm ON fm.contact_id = c.id WHERE fm.folder_id = ? ORDER BY c.name').all(folderId)
  })
  ipcMain.handle('folders:addMember', (_, folderId, contactId) => {
    try { db.prepare('INSERT INTO folder_members (folder_id, contact_id) VALUES (?, ?)').run(folderId, contactId); return true } catch { return false }
  })
  ipcMain.handle('folders:removeMember', (_, folderId, contactId) => {
    db.prepare('DELETE FROM folder_members WHERE folder_id = ? AND contact_id = ?').run(folderId, contactId)
    return true
  })

  // MESSAGES
  ipcMain.handle('messages:getByContact', (_, contactId, limit = 50, offset = 0) => {
    return db.prepare('SELECT * FROM messages WHERE contact_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(contactId, limit, offset)
  })
  ipcMain.handle('messages:insert', (_, data) => {
    const result = db.prepare(`INSERT INTO messages (account_id, contact_id, wa_message_id, body, media_type, media_path, media_mime, media_filename, is_from_me, timestamp, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(data.account_id, data.contact_id, data.wa_message_id || null, data.body || '', data.media_type || 'text',
        data.media_path || null, data.media_mime || null, data.media_filename || null, data.is_from_me ? 1 : 0, data.timestamp, data.status || 'sent')
    return { id: result.lastInsertRowid }
  })
  ipcMain.handle('messages:search', (_, accountId, query) => {
    return db.prepare('SELECT m.*, c.name as contact_name FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE m.account_id = ? AND m.body LIKE ? ORDER BY m.timestamp DESC LIMIT 50')
      .all(accountId, `%${query}%`)
  })

  // Risolvi phone_numbers a nomi (per menzioni @numero nei messaggi di gruppo)
  ipcMain.handle('messages:resolvePhoneNumbers', (_, accountId, phoneNumbers) => {
    const map = {}
    if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) return map
    
    console.log(`[IPC] resolvePhoneNumbers accountId=${accountId}, numeri=${phoneNumbers.join(',')}`)
    
    for (const phoneNum of phoneNumbers) {
      if (map[phoneNum]) continue // già risolto
      
      let contact = null
      
      // Prova 1: match esatto su phone_number
      contact = db.prepare('SELECT name, push_name, phone_number, whatsapp_id FROM contacts WHERE account_id = ? AND phone_number = ?')
        .get(accountId, phoneNum)
      
      // Prova 2: il numero potrebbe essere un WhatsApp ID puro, cerca in whatsapp_id strippando @c.us
      if (!contact) {
        contact = db.prepare('SELECT name, push_name, phone_number, whatsapp_id FROM contacts WHERE account_id = ? AND whatsapp_id LIKE ?')
          .get(accountId, `${phoneNum}@%`)
      }
      
      // Prova 3: match dopo stripping prefissi (+ e 00)
      if (!contact) {
        const stripped = phoneNum.replace(/^(\+|00)/, '')
        contact = db.prepare(`SELECT name, push_name, phone_number, whatsapp_id FROM contacts WHERE account_id = ? AND REPLACE(REPLACE(phone_number, '+', ''), '00', '') = ?`)
          .get(accountId, stripped)
      }
      
      if (contact) {
        // Priorità: name > push_name > phone_number > whatsapp_id
        map[phoneNum] = contact.name || contact.push_name || contact.phone_number || contact.whatsapp_id.split('@')[0] || phoneNum
        console.log(`[IPC]   ${phoneNum} → ${map[phoneNum]} (trovato in whatsapp_id: ${contact.whatsapp_id})`)
      } else {
        map[phoneNum] = phoneNum // fallback: numero stesso
        console.log(`[IPC]   ${phoneNum} → ${phoneNum} (NOT FOUND in DB)`)
      }
    }
    return map
  })

  // SCHEDULED MESSAGES
  ipcMain.handle('scheduled:getAll', (_, accountId) => {
    return db.prepare('SELECT * FROM scheduled_messages WHERE account_id = ? ORDER BY next_send_at').all(accountId)
  })
  ipcMain.handle('scheduled:create', (_, data) => {
    const result = db.prepare(`INSERT INTO scheduled_messages (account_id, target_type, target_id, target_name, body, media_type, media_path, scheduled_at, recurrence_type, recurrence_rule, next_send_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(data.account_id, data.target_type, data.target_id, data.target_name || '', data.body || '', data.media_type || 'text',
        data.media_path || null, data.scheduled_at, data.recurrence_type || 'once', data.recurrence_rule || null, data.next_send_at || data.scheduled_at)
    
    const newMsg = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(result.lastInsertRowid)
    if (scheduler) scheduler.scheduleOne(newMsg)

    return { id: result.lastInsertRowid }
  })
  ipcMain.handle('scheduled:update', (_, id, data) => {
    const fields = [], values = []
    Object.entries(data).forEach(([k, v]) => { if (k !== 'id') { fields.push(`${k} = ?`); values.push(v) } })
    values.push(id)
    db.prepare(`UPDATE scheduled_messages SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    if (scheduler) {
      const updated = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(id)
      scheduler.reschedule(updated)
    }
    return true
  })
  ipcMain.handle('scheduled:delete', (_, id) => {
    if (scheduler) scheduler.cancelOne(id)
    db.prepare('DELETE FROM scheduled_messages WHERE id = ?').run(id)
    return true
  })


  // TASKS
  ipcMain.handle('tasks:getAll', (_, filters = {}) => {
    let q = 'SELECT * FROM tasks WHERE 1=1'; const p = []
    if (filters.status) { q += ' AND status = ?'; p.push(filters.status) }
    if (filters.priority) { q += ' AND priority = ?'; p.push(filters.priority) }
    q += ' ORDER BY created_at DESC'
    return db.prepare(q).all(...p)
  })
  ipcMain.handle('tasks:create', (_, data) => {
    if (data.source_message_id) {
      const msgExists = db.prepare('SELECT id FROM messages WHERE id = ?').get(data.source_message_id)
      if (!msgExists) data.source_message_id = null
    }
    const result = db.prepare('INSERT INTO tasks (title, description, status, priority, due_date, source_message_id, notify, notify_at, recurrence_type, recurrence_rule) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(data.title, data.description || '', data.status || 'todo', data.priority || null, data.due_date || null, data.source_message_id || null, data.notify ? 1 : 0, data.notify_at || null, data.recurrence_type || 'once', data.recurrence_rule || null)
    return { id: result.lastInsertRowid }
  })
  ipcMain.handle('tasks:update', (_, id, data) => {
    const fields = ["updated_at = datetime('now')"], values = []
    Object.entries(data).forEach(([k, v]) => { if (k !== 'id') { fields.push(`${k} = ?`); values.push(v) } })
    values.push(id)
    db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return true
  })
  ipcMain.handle('tasks:delete', (_, id) => {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    return true
  })
  ipcMain.handle('tasks:getLabels', (_, taskId) => {
    return db.prepare('SELECT tl.* FROM task_labels tl JOIN task_label_map tlm ON tlm.label_id = tl.id WHERE tlm.task_id = ?').all(taskId)
  })

  ipcMain.handle('tasks:search', (_, query) => {
    return db.prepare('SELECT * FROM tasks WHERE title LIKE ? OR description LIKE ? ORDER BY created_at DESC LIMIT 20')
      .all(`%${query}%`, `%${query}%`)
  })

  // TASK LABELS
  ipcMain.handle('taskLabels:getAll', () => {
    return db.prepare('SELECT * FROM task_labels ORDER BY name').all()
  })
  ipcMain.handle('taskLabels:create', (_, data) => {
    const result = db.prepare('INSERT INTO task_labels (name, color) VALUES (?, ?)').run(data.name, data.color || '#6C3CE1')
    return { id: result.lastInsertRowid }
  })
  ipcMain.handle('taskLabels:delete', (_, id) => {
    db.prepare('DELETE FROM task_labels WHERE id = ?').run(id)
    return true
  })
  ipcMain.handle('taskLabels:assign', (_, taskId, labelId) => {
    try { db.prepare('INSERT INTO task_label_map (task_id, label_id) VALUES (?, ?)').run(taskId, labelId); return true } catch { return false }
  })
  ipcMain.handle('taskLabels:unassign', (_, taskId, labelId) => {
    db.prepare('DELETE FROM task_label_map WHERE task_id = ? AND label_id = ?').run(taskId, labelId)
    return true
  })

  ipcMain.handle('file:open', async (_, filePath) => {
    return shell.openPath(filePath)
  })

  // MAINTENANCE
  ipcMain.handle('contacts:dedupe', () => dedupeContacts())

  // NOTIFICATIONS
  ipcMain.handle('notify:test', (_, title, body) => {
    if (notificationManager) notificationManager.notify({ title: title || 'Test', body: body || 'Notifica di prova' })
    return true
  })
}

module.exports = { registerIpcHandlers }

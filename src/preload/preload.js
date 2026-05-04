const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // Settings
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  getAllSettings: () => ipcRenderer.invoke('settings:getAll'),

  // Accounts
  getAccounts: () => ipcRenderer.invoke('accounts:getAll'),
  createAccount: (data) => ipcRenderer.invoke('accounts:create', data),
  updateAccount: (id, data) => ipcRenderer.invoke('accounts:update', id, data),
  deleteAccount: (id) => ipcRenderer.invoke('accounts:delete', id),

  // Contacts
  getContacts: (accountId) => ipcRenderer.invoke('contacts:getAll', accountId),
  getGroups: (accountId) => ipcRenderer.invoke('contacts:getGroups', accountId),
  searchContacts: (accountId, query) => ipcRenderer.invoke('contacts:search', accountId, query),
  upsertContact: (data) => ipcRenderer.invoke('contacts:upsert', data),
  updateUnread: (contactId, count) => ipcRenderer.invoke('contacts:updateUnread', contactId, count),

  // Folders
  getFolders: () => ipcRenderer.invoke('folders:getAll'),
  createFolder: (data) => ipcRenderer.invoke('folders:create', data),
  openFile: (filePath) => ipcRenderer.invoke('file:open', filePath),
  updateFolder: (id, data) => ipcRenderer.invoke('folders:update', id, data),
  deleteFolder: (id) => ipcRenderer.invoke('folders:delete', id),
  getFolderMembers: (folderId) => ipcRenderer.invoke('folders:getMembers', folderId),
  addFolderMember: (folderId, contactId) => ipcRenderer.invoke('folders:addMember', folderId, contactId),
  removeFolderMember: (folderId, contactId) => ipcRenderer.invoke('folders:removeMember', folderId, contactId),

  // Messages
  getMessages: (contactId, limit, offset) => ipcRenderer.invoke('messages:getByContact', contactId, limit, offset),
  insertMessage: (data) => ipcRenderer.invoke('messages:insert', data),
  searchMessages: (accountId, query) => ipcRenderer.invoke('messages:search', accountId, query),
  resolvePhoneNumbers: (accountId, phoneNumbers) => ipcRenderer.invoke('messages:resolvePhoneNumbers', accountId, phoneNumbers),

  // Scheduled messages
  getScheduled: (accountId) => ipcRenderer.invoke('scheduled:getAll', accountId),
  createScheduled: (data) => ipcRenderer.invoke('scheduled:create', data),
  updateScheduled: (id, data) => ipcRenderer.invoke('scheduled:update', id, data),
  deleteScheduled: (id) => ipcRenderer.invoke('scheduled:delete', id),

  // Tasks
  getTasks: (filters) => ipcRenderer.invoke('tasks:getAll', filters),
  createTask: (data) => ipcRenderer.invoke('tasks:create', data),
  updateTask: (id, data) => ipcRenderer.invoke('tasks:update', id, data),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', id),
  searchTasks: (query) => ipcRenderer.invoke('tasks:search', query),
  getTaskLabels: (taskId) => ipcRenderer.invoke('tasks:getLabels', taskId),

  // Task labels
  getAllLabels: () => ipcRenderer.invoke('taskLabels:getAll'),
  createLabel: (data) => ipcRenderer.invoke('taskLabels:create', data),
  deleteLabel: (id) => ipcRenderer.invoke('taskLabels:delete', id),
  assignLabel: (taskId, labelId) => ipcRenderer.invoke('taskLabels:assign', taskId, labelId),
  unassignLabel: (taskId, labelId) => ipcRenderer.invoke('taskLabels:unassign', taskId, labelId),

  // WhatsApp
  initializeWhatsApp: (accountId) => ipcRenderer.invoke('wa:initialize', accountId),
  destroyWhatsApp: (accountId) => ipcRenderer.invoke('wa:destroy', accountId),
  markAsRead: (accountId, contactId) => ipcRenderer.invoke('wa:markAsRead', accountId, contactId),
  markAllAsRead: (accountId) => ipcRenderer.invoke('wa:markAllAsRead', accountId),
  resetHistory: (accountId) => ipcRenderer.invoke('wa:resetHistory', accountId),
  syncChatHistory: (accountId, contactId) => ipcRenderer.invoke('wa:syncChatHistory', accountId, contactId),
  sendMessage: (accountId, contactId, body, options) => ipcRenderer.invoke('wa:sendMessage', accountId, contactId, body, options),
  downloadMedia: (accountId, messageDbId) => ipcRenderer.invoke('wa:downloadMedia', accountId, messageDbId),

  // Event listeners (per messaggi WhatsApp in tempo reale)
  onWhatsAppEvent: (channel, callback) => {
    const validChannels = ['wa:qr', 'wa:ready', 'wa:message', 'wa:disconnected', 'wa:auth-failure', 'wa:loading', 'wa:contacts-synced', 'wa:contacts-updated', 'wa:history-synced', 'wa:error', 'wa:sync-progress']
    if (validChannels.includes(channel)) {
      const listener = (_, ...args) => callback(...args)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }
  },

  // Generic event listener (scheduled:updated, notification:task-click, window:maxState, ...)
  on: (channel, callback) => {
    const validChannels = ['scheduled:updated', 'notification:task-click', 'window:maxState']
    if (validChannels.includes(channel)) {
      const listener = (_, ...args) => callback(...args)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }
  },

  // Notifications
  testNotification: (title, body) => ipcRenderer.invoke('notify:test', title, body),

  // Maintenance
  dedupeContacts: () => ipcRenderer.invoke('contacts:dedupe')
})

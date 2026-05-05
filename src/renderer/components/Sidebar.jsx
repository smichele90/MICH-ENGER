import React, { useState, useEffect, useCallback } from 'react'
import { Search, FolderPlus, ChevronRight, Users, User, CheckSquare, Clock, MessageSquare, Hash, MailCheck, RefreshCw } from 'lucide-react'
import FolderTree from './FolderTree'
import AvatarImage from './AvatarImage'

export default function Sidebar({ accountId, activeContact, activeFolder, activeView, onSelectContact, onSelectFolder, onNavigate, onManageFolder }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [contacts, setContacts] = useState([])
  const [groups, setGroups] = useState([])
  const [folders, setFolders] = useState([])
  const [expandedSections, setExpandedSections] = useState({ folders: true, contacts: true, groups: true })
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [sidebarTab, setSidebarTab] = useState('recent') // recent, contacts, groups

  // Carica dati quando cambia l'account
  useEffect(() => {
    if (!accountId) return
    async function load() {
      const [c, g, f] = await Promise.all([
        window.api.getContacts(accountId),
        window.api.getGroups(accountId),
        window.api.getFolders()
      ])
      setContacts(c)
      setGroups(g)
      setFolders(f)
    }
    load()

    // Listener per nuovi messaggi (aggiorna contatori)
    // Listeners per aggiornamenti
    const removeMsgListener = window.api.onWhatsAppEvent('wa:message', ({ accountId: msgAccountId }) => {
      if (msgAccountId === accountId) load()
    })
    const removeHistoryListener = window.api.onWhatsAppEvent('wa:history-synced', ({ accountId: msgAccountId }) => {
      if (msgAccountId === accountId) load()
    })
    const removeContactsListener = window.api.onWhatsAppEvent('wa:contacts-updated', ({ accountId: msgAccountId }) => {
      if (msgAccountId === accountId) load()
    })

    return () => {
      removeMsgListener?.()
      removeHistoryListener?.()
      removeContactsListener?.()
    }
  }, [accountId, activeContact?.id])

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  // Crea nuova cartella
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    const result = await window.api.createFolder({ name: newFolderName.trim() })
    if (result?.id) {
      setFolders(await window.api.getFolders())
      setNewFolderName('')
      setShowNewFolder(false)
    }
  }

  // Filtra contatti per ricerca
  const filteredContacts = searchQuery
    ? contacts.filter(c => c.name?.toLowerCase().includes(searchQuery.toLowerCase()) || c.phone_number?.includes(searchQuery))
    : contacts

  const filteredGroups = searchQuery
    ? groups.filter(g => g.name?.toLowerCase().includes(searchQuery.toLowerCase()))
    : groups

  // CRONOLOGIA: unione di contatti + gruppi con messaggi, ordinati per ultima attività
  // (come WhatsApp Web). Filtra per searchQuery se presente.
  const recentItems = React.useMemo(() => {
    const all = [...contacts, ...groups]
      .filter(c => c.last_message_at)
      .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))
    if (!searchQuery) return all
    const q = searchQuery.toLowerCase()
    return all.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.push_name?.toLowerCase().includes(q) ||
      c.phone_number?.includes(searchQuery)
    )
  }, [contacts, groups, searchQuery])

  // Costruisci albero cartelle
  const buildTree = useCallback((items, parentId = null) => {
    return items
      .filter(f => f.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map(f => ({ ...f, children: buildTree(items, f.id) }))
  }, [])

  const folderTree = buildTree(folders)

  const refreshFolders = async () => {
    setFolders(await window.api.getFolders())
  }

  const formatLastTime = (ts) => {
    if (!ts) return ''
    const d = new Date(ts)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
  }

  const unreadContacts = contacts.reduce((sum, c) => sum + (c.unread_count || 0), 0)
  const unreadGroups = groups.reduce((sum, c) => sum + (c.unread_count || 0), 0)
  const unreadTotal = unreadContacts + unreadGroups

  return (
    <div className="sidebar">
      {/* Ricerca */}
      <div className="sidebar__search">
        <div className="sidebar__search-wrapper">
          <Search size={14} className="sidebar__search-icon" />
          <input
            className="sidebar__search-input"
            placeholder="Cerca contatti, messaggi..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Tabs navigazione */}
      <div className="nav-tabs">
        <button className={`nav-tab ${activeView === 'chat' ? 'nav-tab--active' : ''}`} onClick={() => onNavigate('chat')}>
          <MessageSquare size={14} style={{ marginRight: 4 }} /> Chat
          {unreadTotal > 0 && <span style={{ marginLeft: 'auto', background: 'var(--accent)', color: 'white', padding: '0 6px', borderRadius: 10, fontSize: 10, fontWeight: 600 }}>{unreadTotal}</span>}
        </button>
        <button className={`nav-tab ${activeView === 'tasks' ? 'nav-tab--active' : ''}`} onClick={() => onNavigate('tasks')}>
          <CheckSquare size={14} style={{ marginRight: 4 }} /> Task
        </button>
        <button className={`nav-tab ${activeView === 'scheduled' ? 'nav-tab--active' : ''}`} onClick={() => onNavigate('scheduled')}>
          <Clock size={14} style={{ marginRight: 4 }} /> Programmati
        </button>
      </div>

      {/* Contenuto sidebar */}
      <div className="sidebar__content">
        {activeView === 'chat' && (
          <div className="sidebar-chat-tabs">
            <button className={`chat-tab ${sidebarTab === 'recent' ? 'chat-tab--active' : ''}`} onClick={() => setSidebarTab('recent')}>
              Cronologia {unreadTotal > 0 && <span style={{ background: 'var(--accent)', color: 'white', padding: '0 4px', borderRadius: 8, fontSize: 10, marginLeft: 4, fontWeight: 600 }}>{unreadTotal}</span>}
            </button>
            <button className={`chat-tab ${sidebarTab === 'contacts' ? 'chat-tab--active' : ''}`} onClick={() => setSidebarTab('contacts')}>
              Contatti {unreadContacts > 0 && <span style={{ background: 'var(--accent)', color: 'white', padding: '0 4px', borderRadius: 8, fontSize: 10, marginLeft: 4, fontWeight: 600 }}>{unreadContacts}</span>}
            </button>
            <button className={`chat-tab ${sidebarTab === 'groups' ? 'chat-tab--active' : ''}`} onClick={() => setSidebarTab('groups')}>
              Gruppi {unreadGroups > 0 && <span style={{ background: 'var(--accent)', color: 'white', padding: '0 4px', borderRadius: 8, fontSize: 10, marginLeft: 4, fontWeight: 600 }}>{unreadGroups}</span>}
            </button>
          </div>
        )}

        {/* Cartelle (sempre visibili o solo in chat?) */}
        <div className="sidebar-section">
          <div className="sidebar-section__header" onClick={() => toggleSection('folders')}>
            <span className="sidebar-section__title">📁 Cartelle</span>
            <button className="sidebar-section__action" onClick={(e) => { e.stopPropagation(); setShowNewFolder(true) }} title="Nuova cartella">
              <FolderPlus size={14} />
            </button>
          </div>
          {showNewFolder && (
            <div style={{ padding: '4px 16px', display: 'flex', gap: 4 }}>
              <input 
                autoFocus
                className="sidebar__search-input"
                placeholder="Nome cartella..."
                value={newFolderName}
                onClick={e => e.stopPropagation()}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateFolder()
                  if (e.key === 'Escape') setShowNewFolder(false)
                }}
                style={{ flex: 1, padding: '4px 8px', fontSize: 12, outline: 'none' }}
              />
              <button 
                onClick={handleCreateFolder}
                style={{ background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 4, padding: '0 8px', cursor: 'pointer', fontSize: 12 }}
              >OK</button>
            </div>
          )}
          {expandedSections.folders && (
            <FolderTree
              folders={folderTree}
              activeFolder={activeFolder}
              activeContact={activeContact}
              onSelect={onSelectFolder}
              onSelectContact={onSelectContact}
              onRefresh={refreshFolders}
              onManage={onManageFolder}
            />
          )}
        </div>

        {/* Lista dinamica in base al tab */}
        <div className="sidebar-section">
          <div className="sidebar-section__header">
            <span className="sidebar-section__title">
              {sidebarTab === 'recent' ? '💬 Conversazioni Recenti' : sidebarTab === 'contacts' ? '👤 Tutti i Contatti' : '👥 Gruppi'}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                className="sidebar-section__action" 
                style={{ opacity: 1 }}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (window.confirm('Vuoi ricaricare tutta la cronologia? Questo scaricherà nuovamente i media mancanti.')) {
                    const result = await window.api.resetHistory(accountId);
                    if (result && !result.success) {
                      alert('Errore durante il ricaricamento: ' + result.error);
                    } else if (!result) {
                      // Compatibility for older returns
                    }
                  }
                }}
                title="Ricarica cronologia"
              >
                <RefreshCw size={14} />
              </button>
              <button 
                className="sidebar-section__action" 
                style={{ opacity: 1 }}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (window.confirm('Segnare tutti i messaggi come letti?')) {
                    await window.api.markAllAsRead(accountId);
                  }
                }}
                title="Segna tutto come letto"
              >
                <MailCheck size={14} />
              </button>
            </div>
          </div>
          
          <div className="sidebar-items">
            {(sidebarTab === 'recent' ? recentItems : (sidebarTab === 'contacts' ? filteredContacts : filteredGroups)).map(item => (
              <div
                key={item.id}
                className={`sidebar-item ${activeContact?.id === item.id ? 'sidebar-item--active' : ''}`}
                onClick={() => onSelectContact(item)}
                style={{ padding: '8px 12px', height: 'auto' }}
              >
                <div className="sidebar-item__avatar" style={{ 
                  width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-hover)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                  overflow: 'hidden'
                }}>
                  <AvatarImage
                    profilePicPath={item.profile_pic_path}
                    profilePicUrl={item.profile_pic_url}
                    isGroup={item.is_group}
                    className="sidebar-item__avatar"
                    style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', background: 'var(--bg-hover)' }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span className="sidebar-item__label" style={{ fontWeight: item.unread_count > 0 ? 700 : 500, fontSize: 13 }}>
                      {item.name || item.push_name || item.phone_number}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {formatLastTime(item.last_message_at)}
                    </span>
                  </div>
                  {sidebarTab === 'recent' && (
                    <div style={{ 
                      fontSize: 11, color: item.unread_count > 0 ? 'var(--text-primary)' : 'var(--text-muted)', 
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' 
                    }}>
                      {item.last_message_body || 'Nessun messaggio'}
                    </div>
                  )}
                </div>
                {item.unread_count > 0 && (
                  <span className="sidebar-item__badge" style={{ marginLeft: 8 }}>{item.unread_count}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

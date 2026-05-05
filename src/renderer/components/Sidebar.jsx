import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Search, FolderPlus, CheckSquare, Clock, MessageSquare, MailCheck, RefreshCw } from 'lucide-react'
import FolderTree from './FolderTree'
import AvatarImage from './AvatarImage'

const MEDIA_LABELS = {
  image:    '📷 Foto',
  video:    '🎥 Video',
  audio:    '🎵 Audio',
  ptt:      '🎙 Vocale',
  voice:    '🎙 Vocale',
  sticker:  '🔵 Sticker',
}

function PreviewText({ body, mediaType, mediaFilename, isGroup, accountId }) {
  const [resolvedBody, setResolvedBody] = useState(null)

  useEffect(() => {
    setResolvedBody(null)
    if (!isGroup || !body || !/@\d/.test(body) || (mediaType && mediaType !== 'text')) return
    const nums = []
    const rx = /@(\d{1,20})/g
    let m
    while ((m = rx.exec(body)) !== null) nums.push(m[1])
    if (!nums.length) return
    window.api.resolvePhoneNumbers(accountId, nums)
      .then(map => setResolvedBody(body.replace(/@(\d{1,20})/g, (_, n) => `@${map[n] || n}`)))
      .catch(() => {})
  }, [body, mediaType, isGroup, accountId])

  if (mediaType && mediaType !== 'text') {
    if (body?.trim()) return body
    if (mediaType === 'document') return mediaFilename ? `📄 ${mediaFilename}` : '📄 Documento'
    return MEDIA_LABELS[mediaType] ?? body ?? 'Nessun messaggio'
  }
  return resolvedBody ?? body ?? 'Nessun messaggio'
}

export default function Sidebar({ accountId, activeContact, activeFolder, activeView, collapsed, onSelectContact, onSelectFolder, onNavigate, onManageFolder }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [contacts, setContacts] = useState([])
  const [groups, setGroups] = useState([])
  const [folders, setFolders] = useState([])
  const [expandedSections, setExpandedSections] = useState({ folders: true, contacts: true, groups: true })
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [sidebarTab, setSidebarTab] = useState('recent') // recent, contacts, groups

  // Debounce per ricerca
  const searchTimeoutRef = useRef(null)
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 300)
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [searchQuery])

  // Carica dati quando cambia l'account
  useEffect(() => {
    if (!accountId) return
    async function loadContactsGroups() {
      const [c, g] = await Promise.all([
        window.api.getContacts(accountId),
        window.api.getGroups(accountId),
      ])
      setContacts(c)
      setGroups(g)
    }
    async function loadAll() {
      const [c, g, f] = await Promise.all([
        window.api.getContacts(accountId),
        window.api.getGroups(accountId),
        window.api.getFolders()
      ])
      setContacts(c)
      setGroups(g)
      setFolders(f)
    }
    loadAll()

    // I messaggi aggiornano solo contatti/gruppi (contatori non letti) — le cartelle non cambiano
    const removeMsgListener = window.api.onWhatsAppEvent('wa:message', ({ accountId: msgAccountId }) => {
      if (msgAccountId === accountId) loadContactsGroups()
    })
    const removeHistoryListener = window.api.onWhatsAppEvent('wa:history-synced', ({ accountId: msgAccountId }) => {
      if (msgAccountId === accountId) loadAll()
    })
    const removeContactsListener = window.api.onWhatsAppEvent('wa:contacts-updated', ({ accountId: msgAccountId }) => {
      if (msgAccountId === accountId) loadContactsGroups()
    })

    return () => {
      removeMsgListener?.()
      removeHistoryListener?.()
      removeContactsListener?.()
    }
  }, [accountId])

  const toggleSection = useCallback((section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }, [])

  const handleFolderAdded = useCallback((newFolder) => {
    setFolders(prev => [...prev, newFolder])
  }, [])

  const handleFolderUpdated = useCallback((id, changes) => {
    setFolders(prev => prev.map(f => f.id === id ? { ...f, ...changes } : f))
  }, [])

  const handleFolderRemoved = useCallback((id) => {
    setFolders(prev => {
      const toRemove = new Set()
      const collect = (fid) => {
        toRemove.add(fid)
        prev.filter(f => f.parent_id === fid).forEach(f => collect(f.id))
      }
      collect(id)
      return prev.filter(f => !toRemove.has(f.id))
    })
  }, [])

  // Crea nuova cartella
  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim() || creatingFolder) return
    setCreatingFolder(true)
    try {
      const result = await window.api.createFolder({ name: newFolderName.trim() })
      if (result?.id) {
        handleFolderAdded({ id: result.id, name: newFolderName.trim(), parent_id: null, color: '#6C3CE1', icon: 'folder', sort_order: 0 })
        setNewFolderName('')
        setShowNewFolder(false)
      }
    } finally {
      setCreatingFolder(false)
    }
  }, [newFolderName, creatingFolder, handleFolderAdded])

  // Filtra contatti per ricerca
  const filteredContacts = useMemo(() => {
    if (!debouncedSearchQuery) return contacts
    const q = debouncedSearchQuery.toLowerCase()
    return contacts.filter(c => 
      c.name?.toLowerCase().includes(q) || 
      c.phone_number?.includes(debouncedSearchQuery)
    )
  }, [contacts, debouncedSearchQuery])

  const filteredGroups = useMemo(() => {
    if (!debouncedSearchQuery) return groups
    const q = debouncedSearchQuery.toLowerCase()
    return groups.filter(g => g.name?.toLowerCase().includes(q))
  }, [groups, debouncedSearchQuery])

  // CRONOLOGIA: unione di contatti + gruppi con messaggi, ordinati per ultima attività
  // (come WhatsApp Web). Filtra per searchQuery se presente.
  const recentItems = useMemo(() => {
    const all = [...contacts, ...groups]
      .filter(c => c.last_message_at)
      .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))
    if (!debouncedSearchQuery) return all
    const q = debouncedSearchQuery.toLowerCase()
    return all.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.push_name?.toLowerCase().includes(q) ||
      c.phone_number?.includes(debouncedSearchQuery)
    )
  }, [contacts, groups, debouncedSearchQuery])

  // Costruisci albero cartelle
  const buildTree = useCallback((items, parentId = null) => {
    return items
      .filter(f => f.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map(f => ({ ...f, children: buildTree(items, f.id) }))
  }, [])

  const folderTree = useMemo(() => buildTree(folders), [folders, buildTree])

  const refreshFolders = useCallback(async () => {
    setFolders(await window.api.getFolders())
  }, [])

  const formatLastTime = useCallback((ts) => {
    if (!ts) return ''
    const d = new Date(ts)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
  }, [])

  const unreadContacts = useMemo(() => 
    contacts.reduce((sum, c) => sum + (c.unread_count || 0), 0),
    [contacts]
  )
  const unreadGroups = useMemo(() => 
    groups.reduce((sum, c) => sum + (c.unread_count || 0), 0),
    [groups]
  )
  const unreadTotal = unreadContacts + unreadGroups

  if (collapsed) {
    return (
      <div className="sidebar sidebar--collapsed">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0', gap: 6 }}>
          <button
            className="sidebar-collapse-btn"
            onClick={() => onNavigate('chat')}
            title="Chat"
          >
            <MessageSquare size={20} />
            {unreadTotal > 0 && (
              <span className="sidebar-collapse-badge">{unreadTotal > 99 ? '99+' : unreadTotal}</span>
            )}
          </button>
          <button
            className={`sidebar-collapse-btn ${activeView === 'tasks' ? 'sidebar-collapse-btn--active' : ''}`}
            onClick={() => onNavigate('tasks')}
            title="Task"
          >
            <CheckSquare size={20} />
          </button>
          <button
            className={`sidebar-collapse-btn ${activeView === 'scheduled' ? 'sidebar-collapse-btn--active' : ''}`}
            onClick={() => onNavigate('scheduled')}
            title="Programmati"
          >
            <Clock size={20} />
          </button>
        </div>
      </div>
    )
  }

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
                disabled={creatingFolder}
                style={{ 
                  background: creatingFolder ? 'var(--text-muted)' : 'var(--accent)', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: 4, 
                  padding: '0 8px', 
                  cursor: creatingFolder ? 'not-allowed' : 'pointer', 
                  fontSize: 12 
                }}
              >
                {creatingFolder ? '...' : 'OK'}
              </button>
            </div>
          )}
          {expandedSections.folders && (
            <FolderTree
              folders={folderTree}
              activeFolder={activeFolder}
              activeContact={activeContact}
              onSelect={onSelectFolder}
              onSelectContact={onSelectContact}
              onFolderAdded={handleFolderAdded}
              onFolderUpdated={handleFolderUpdated}
              onFolderRemoved={handleFolderRemoved}
              onRefresh={refreshFolders}
              onManage={onManageFolder}
            />
          )}
        </div>

        {/* Lista contatti/conversazioni — visibile solo nella scheda Chat */}
        {activeView === 'chat' && (
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
                  style={{ padding: '10px 16px', minHeight: 68 }}
                >
                  <div className="sidebar-item__avatar" style={{
                    width: 48, height: 48, borderRadius: '50%', background: 'var(--bg-hover)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    fontSize: 14, fontWeight: 600, color: 'var(--text-muted)',
                    overflow: 'hidden'
                  }}>
                    <AvatarImage
                      profilePicPath={item.profile_pic_path}
                      profilePicUrl={item.profile_pic_url}
                      isGroup={item.is_group}
                      className="sidebar-item__avatar"
                      style={{ width: 48, height: 48, borderRadius: '50%', overflow: 'hidden', background: 'var(--bg-hover)' }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <span className="sidebar-item__label" style={{ fontWeight: item.unread_count > 0 ? 700 : 500, fontSize: 15 }}>
                        {item.name || item.push_name || item.phone_number}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 6 }}>
                        {formatLastTime(item.last_message_at)}
                      </span>
                    </div>
                    {sidebarTab === 'recent' && (
                      <div style={{
                        fontSize: 13, color: item.unread_count > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                      }}>
                        <PreviewText
                          body={item.last_message_body}
                          mediaType={item.last_message_type}
                          mediaFilename={item.last_message_filename}
                          isGroup={!!item.is_group}
                          accountId={accountId}
                        />
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
        )}
      </div>
    </div>
  )
}

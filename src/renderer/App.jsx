import React, { useState, useEffect, useCallback } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'
import Sidebar from './components/Sidebar'
import AccountSwitcher from './components/AccountSwitcher'
import ChatView from './components/ChatView'
import TaskView from './components/TaskView'
import ScheduledList from './components/ScheduledList'
import QRCodeModal from './components/QRCodeModal'
import SearchOverlay from './components/SearchOverlay'
import FolderContactManager from './components/FolderContactManager'
export default function App() {
  const [theme, setTheme] = useState('dark')
  const [accounts, setAccounts] = useState([])
  const [activeAccount, setActiveAccount] = useState(null)
  const [activeView, setActiveView] = useState('chat') // chat, tasks, scheduled
  const [activeContact, setActiveContact] = useState(null)
  const [activeFolder, setActiveFolder] = useState(null)
  const [showQRModal, setShowQRModal] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const [managingFolder, setManagingFolder] = useState(null)
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0)
  const [connectionStatuses, setConnectionStatuses] = useState({})

  // Carica tema e accounts all'avvio
  useEffect(() => {
    async function init() {
      const savedTheme = await window.api.getSetting('theme')
      if (savedTheme) {
        setTheme(savedTheme)
        document.documentElement.setAttribute('data-theme', savedTheme)
      }
      const accs = await window.api.getAccounts()
      // Filtra gli account "fantasma" (senza numero e non attivi) per la visualizzazione iniziale
      const validAccs = accs.filter(a => a.phone_number || a.is_active)
      setAccounts(validAccs)

      if (validAccs.length > 0) {
        setActiveAccount(validAccs[0])
        // Inizializza solo gli account che hanno già un numero (già associati)
        const toInit = accs.filter(a => a.phone_number)
        const initStatus = {}
        toInit.forEach(acc => { initStatus[acc.id] = 'loading' })
        setConnectionStatuses(initStatus)
        toInit.forEach(acc => {
          window.api.initializeWhatsApp(acc.id).catch(err => console.error(err))
        })
      }
    }
    init()

    // Shortcut Ctrl+K per ricerca
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setShowSearch(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Ascolta eventi di stato connessione WhatsApp (globale, per tutti gli account)
  useEffect(() => {
    const set = (accountId, status) =>
      setConnectionStatuses(prev => ({ ...prev, [accountId]: status }))
    const offReady   = window.api.onWhatsAppEvent('wa:ready',       ({ accountId }) => set(accountId, 'ready'))
    const offLoading = window.api.onWhatsAppEvent('wa:loading',     ({ accountId }) => set(accountId, 'loading'))
    const offDisc    = window.api.onWhatsAppEvent('wa:disconnected', ({ accountId }) => set(accountId, 'disconnected'))
    const offErr     = window.api.onWhatsAppEvent('wa:error',       ({ accountId }) => set(accountId, 'error'))
    return () => { offReady?.(); offLoading?.(); offDisc?.(); offErr?.() }
  }, [])

  const handleReconnect = useCallback(async (accountId) => {
    setConnectionStatuses(prev => ({ ...prev, [accountId]: 'loading' }))
    await window.api.initializeWhatsApp(accountId)
  }, [])

  // Toggle tema
  const toggleTheme = useCallback(async () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
    await window.api.setSetting('theme', newTheme)
  }, [theme])

  // Window controls + ascolto stato max dal main
  useEffect(() => {
    window.api.isMaximized().then(setIsMaximized).catch(() => {})
    const off = window.api.on?.('window:maxState', (state) => setIsMaximized(state))
    return () => off?.()
  }, [])
  const handleMinimize = () => window.api.minimize()
  const handleMaximize = () => window.api.maximize()
  const handleClose = () => window.api.close()

  // Account handlers
  const handleAddAccount = () => setShowQRModal(true)
  const handleSelectAccount = (account) => {
    setActiveAccount(account)
    setActiveContact(null)
    setActiveFolder(null)
  }
  const handleDeleteAccount = async (id) => {
    if (confirm('Sei sicuro di voler eliminare questo account?')) {
      await window.api.deleteAccount(id)
      setAccounts(prev => prev.filter(a => a.id !== id))
      if (activeAccount?.id === id) {
        setActiveAccount(null)
      }
    }
  }

  // Navigation handlers
  const handleSelectContact = (contact) => {
    setActiveContact(contact)
    setActiveFolder(null)
    setActiveView('chat')
  }
  const handleSelectFolder = (folder) => {
    setActiveFolder(folder)
  }
  const handleNavigate = useCallback(async (view, options = {}) => {
    setActiveView(view)
    if (view === 'chat') {
      if (options.contact) setActiveContact(options.contact)
      if (options.folder) setActiveFolder(options.folder)
      if (options.contactId) {
        const all = await window.api.getContacts(activeAccount?.id)
        const found = all.find(c => c.id === options.contactId)
        if (found) setActiveContact(found)
      }
    } else {
      setActiveContact(null)
      setActiveFolder(null)
    }
  }, [activeAccount?.id])

  // Renderizza la vista principale
  const renderMainView = () => {
    switch (activeView) {
      case 'tasks':
        return <TaskView />
      case 'scheduled':
        return <ScheduledList accountId={activeAccount?.id} />
      case 'chat':
      default:
        if (activeContact) {
          return <ChatView contact={activeContact} accountId={activeAccount?.id} />
        }
        return (
          <div className="empty-state">
            <div className="empty-state__icon">💬</div>
            <div className="empty-state__title">MICH-ENGER</div>
            <div className="empty-state__text">
              Seleziona un contatto o un gruppo dalla sidebar per iniziare una conversazione.
            </div>
          </div>
        )
    }
  }

  return (
    <>
      {/* Titlebar personalizzata */}
      <div className="titlebar">
        <span className="titlebar__title">MICH-ENGER</span>
        <div className="titlebar__controls">
          <button className="titlebar__btn" onClick={handleMinimize} title="Riduci">
            <Minus size={14} />
          </button>
          <button className="titlebar__btn" onClick={handleMaximize} title="Ingrandisci">
            {isMaximized ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button className="titlebar__btn titlebar__btn--close" onClick={handleClose} title="Chiudi">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Layout principale */}
      <div className="app-layout">
        {/* Barra account (colonna stretta sinistra) */}
        <AccountSwitcher
          accounts={accounts}
          activeAccount={activeAccount}
          onSelect={handleSelectAccount}
          onAdd={handleAddAccount}
          onDelete={handleDeleteAccount}
          theme={theme}
          onToggleTheme={toggleTheme}
          connectionStatuses={connectionStatuses}
          onReconnect={handleReconnect}
        />

        {/* Sidebar */}
        <Sidebar
          key={sidebarRefreshKey}
          accountId={activeAccount?.id}
          activeContact={activeContact}
          activeFolder={activeFolder}
          activeView={activeView}
          onSelectContact={handleSelectContact}
          onSelectFolder={handleSelectFolder}
          onNavigate={handleNavigate}
          onManageFolder={setManagingFolder}
        />

        {/* Area principale */}
        <div className="main-area">
          {renderMainView()}
        </div>
      </div>

      {/* QR Code Modal */}
      {showQRModal && (
        <QRCodeModal
          onClose={() => setShowQRModal(false)}
          onConnected={(account) => {
            setAccounts(prev => [...prev, account])
            setActiveAccount(account)
            setShowQRModal(false)
          }}
        />
      )}
      {/* Search Overlay */}
      {showSearch && (
        <SearchOverlay
          accountId={activeAccount?.id}
          onClose={() => setShowSearch(false)}
          onNavigate={handleNavigate}
        />
      )}

      {/* Folder Contact Manager */}
      {managingFolder && (
        <FolderContactManager
          folder={managingFolder}
          accountId={activeAccount?.id}
          onClose={() => {
            setManagingFolder(null)
            setSidebarRefreshKey(prev => prev + 1)
          }}
        />
      )}
    </>
  )
}

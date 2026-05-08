import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'
import iconaImg from '../../assets/icona.png'
import Sidebar from './components/Sidebar'
import AccountSwitcher from './components/AccountSwitcher'
import ChatView from './components/ChatView'
import TaskView from './components/TaskView'
import ScheduledList from './components/ScheduledList'
import QRCodeModal from './components/QRCodeModal'
import SearchOverlay from './components/SearchOverlay'
import FolderContactManager from './components/FolderContactManager'
import ConfirmDialog from './components/ConfirmDialog'
function playNotificationSound() {
  try {
    const ctx = new AudioContext()
    const play = (freq, startTime, duration) => {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, startTime)
      gain.gain.exponentialRampToValueAtTime(0.28, startTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)
      osc.start(startTime)
      osc.stop(startTime + duration)
    }
    play(1318, ctx.currentTime,        0.25)  // E6
    play(987,  ctx.currentTime + 0.18, 0.30)  // B5
    setTimeout(() => ctx.close(), 700)
  } catch {}
}

export default function App() {
  const [theme, setTheme] = useState('light')
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
  const [confirmAccId, setConfirmAccId] = useState(null)
  const [highlightMessageId, setHighlightMessageId] = useState(null)
  const [soundEnabled, setSoundEnabled] = useState(true)

  // Ref per leggere i valori aggiornati dentro il listener wa:message senza re-registrarlo
  const activeContactRef = useRef(activeContact)
  const soundEnabledRef  = useRef(true)
  useEffect(() => { activeContactRef.current = activeContact }, [activeContact])
  useEffect(() => { soundEnabledRef.current  = soundEnabled  }, [soundEnabled])

  // Carica tema e accounts all'avvio
  useEffect(() => {
    async function init() {
      const savedTheme = await window.api.getSetting('theme') || 'light'
      setTheme(savedTheme)
      document.documentElement.setAttribute('data-theme', savedTheme)
      localStorage.setItem('theme', savedTheme)
      const savedSound = await window.api.getSetting('soundEnabled')
      if (savedSound === 'false') { setSoundEnabled(false); soundEnabledRef.current = false }
      const savedColors = await window.api.getSetting('customColors')
      if (savedColors) {
        try {
          const parsed = JSON.parse(savedColors)
          // Nuovo formato: { dark: {...}, light: {...} }
          const themeKey = savedTheme || 'light'
          const c = parsed[themeKey]
          if (c) {
            if (c.sidebarBg) document.documentElement.style.setProperty('--bg-sidebar', c.sidebarBg)
            if (c.chatBg) document.documentElement.style.setProperty('--bg-primary', c.chatBg)
            if (c.messageSent) document.documentElement.style.setProperty('--bg-message-me', c.messageSent)
            if (c.messageReceived) document.documentElement.style.setProperty('--bg-message-other', c.messageReceived)
          }
        } catch {}
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
    const offReady   = window.api.onWhatsAppEvent('wa:ready',       ({ accountId, info }) => {
      set(accountId, 'ready')
      if (info?.profilePicUrl) {
        setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, profile_pic_url: info.profilePicUrl } : a))
      }
    })
    const offLoading = window.api.onWhatsAppEvent('wa:loading',     ({ accountId }) =>
      setConnectionStatuses(prev => prev[accountId] === 'ready' ? prev : { ...prev, [accountId]: 'loading' }))
    const offDisc    = window.api.onWhatsAppEvent('wa:disconnected', ({ accountId }) => set(accountId, 'disconnected'))
    const offErr     = window.api.onWhatsAppEvent('wa:error',       ({ accountId }) => set(accountId, 'error'))
    return () => { offReady?.(); offLoading?.(); offDisc?.(); offErr?.() }
  }, [])

  // Suono notifica messaggi in arrivo
  useEffect(() => {
    const off = window.api.onWhatsAppEvent('wa:message', ({ message }) => {
      if (!soundEnabledRef.current) return
      if (message?.is_from_me) return
      if (message?.contact_id === activeContactRef.current?.id) return
      playNotificationSound()
    })
    return () => off?.()
  }, [])

  const toggleSound = useCallback(async () => {
    const next = !soundEnabled
    setSoundEnabled(next)
    await window.api.setSetting('soundEnabled', String(next))
  }, [soundEnabled])

  const handleReconnect = useCallback(async (accountId) => {
    setConnectionStatuses(prev => ({ ...prev, [accountId]: 'loading' }))
    await window.api.initializeWhatsApp(accountId)
  }, [])

  // Toggle tema
  const toggleTheme = useCallback(async () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
    localStorage.setItem('theme', newTheme)
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
  const handleDeleteAccount = (id) => setConfirmAccId(id)

  const confirmDeleteAccount = async () => {
    await window.api.deleteAccount(confirmAccId)
    setAccounts(prev => prev.filter(a => a.id !== confirmAccId))
    if (activeAccount?.id === confirmAccId) setActiveAccount(null)
    setConfirmAccId(null)
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
      if (options.messageId) setHighlightMessageId(options.messageId)
    } else {
      setActiveContact(null)
      setActiveFolder(null)
    }
  }, [activeAccount?.id])

  // Renderizza la vista principale
  const renderMainView = () => {
    switch (activeView) {
      case 'tasks':
        return <TaskView accountId={activeAccount?.id} onNavigate={handleNavigate} />
      case 'scheduled':
        return <ScheduledList accountId={activeAccount?.id} />
      case 'chat':
      default:
        if (activeContact) {
          return <ChatView contact={activeContact} accountId={activeAccount?.id} highlightMessageId={highlightMessageId} onHighlightDone={() => setHighlightMessageId(null)} />
        }
        return (
          <div className="empty-state">
            <div className="empty-state__icon">
              <img src={iconaImg} alt="MICH-ENGER" style={{ width: 80, height: 80, opacity: 0.25, borderRadius: 18 }} />
            </div>
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
            <Minus size={14} strokeWidth={1.6} />
          </button>
          <button className="titlebar__btn" onClick={handleMaximize} title="Ingrandisci">
            {isMaximized ? <Copy size={12} strokeWidth={1.6} /> : <Square size={12} strokeWidth={1.6} />}
          </button>
          <button className="titlebar__btn titlebar__btn--close" onClick={handleClose} title="Chiudi">
            <X size={14} strokeWidth={1.6} />
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
          soundEnabled={soundEnabled}
          onToggleSound={toggleSound}
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
          collapsed={activeView === 'tasks' || activeView === 'scheduled'}
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

      {confirmAccId && (
        <ConfirmDialog
          message="Sei sicuro di voler eliminare questo account?"
          confirmLabel="Elimina"
          onConfirm={confirmDeleteAccount}
          onCancel={() => setConfirmAccId(null)}
        />
      )}
    </>
  )
}

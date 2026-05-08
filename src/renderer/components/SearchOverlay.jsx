import React, { useState, useEffect, useRef } from 'react'
import { Search, MessageSquare, CheckSquare, User, Hash, X, Clock, Calendar } from 'lucide-react'

export default function SearchOverlay({ onClose, accountId, onNavigate }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ contacts: [], messages: [], tasks: [], folders: [] })
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults({ contacts: [], messages: [], tasks: [], folders: [] })
      setSelectedIndex(0)
      return
    }

    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const [contacts, messages, tasks, folders] = await Promise.all([
          window.api.searchContacts(accountId, query),
          window.api.searchMessages(accountId, query),
          window.api.searchTasks(query),
          window.api.getFolders()
        ])

        const filteredFolders = folders.filter(f => 
          f.name.toLowerCase().includes(query.toLowerCase())
        )

        setResults({
          contacts: contacts.slice(0, 5),
          messages: messages.slice(0, 10),
          tasks: tasks.slice(0, 5),
          folders: filteredFolders.slice(0, 3)
        })
        setSelectedIndex(0)
      } catch (err) {
        console.error('Search error:', err)
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query, accountId])

  const flattenedResults = [
    ...results.contacts.map(c => ({ type: 'contact', data: c })),
    ...results.folders.map(f => ({ type: 'folder', data: f })),
    ...results.tasks.map(t => ({ type: 'task', data: t })),
    ...results.messages.map(m => ({ type: 'message', data: m }))
  ]

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => (prev + 1) % Math.max(1, flattenedResults.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => (prev - 1 + flattenedResults.length) % Math.max(1, flattenedResults.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (flattenedResults[selectedIndex]) {
        handleSelect(flattenedResults[selectedIndex])
      }
    }
  }

  const handleSelect = (item) => {
    if (item.type === 'contact') {
      onNavigate('chat', { contact: item.data })
    } else if (item.type === 'folder') {
      onNavigate('chat', { folder: item.data })
    } else if (item.type === 'task') {
      onNavigate('tasks', { task: item.data })
    } else if (item.type === 'message') {
      // For message, navigate to chat and scroll to message (if supported)
      onNavigate('chat', { contactId: item.data.contact_id, messageId: item.data.id })
    }
    onClose()
  }

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-overlay__content" onClick={e => e.stopPropagation()}>
        <div className="search-overlay__input-wrapper">
          <Search className="search-overlay__icon" size={20} strokeWidth={1.6} />
          <input
            ref={inputRef}
            type="text"
            className="search-overlay__input"
            placeholder="Cerca contatti, messaggi, task o comandi..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {loading && <div className="search-overlay__loader" />}
          <kbd className="search-overlay__kbd">ESC</kbd>
        </div>

        <div className="search-overlay__results custom-scrollbar">
          {flattenedResults.length === 0 ? (
            <div className="search-overlay__empty">
              {query.trim().length < 2 ? (
                <>
                  <p>Inizia a digitare per cercare...</p>
                  <div className="search-overlay__hints">
                    <span><Hash size={12} strokeWidth={1.6} /> Gruppi</span>
                    <span><User size={12} strokeWidth={1.6} /> Contatti</span>
                    <span><CheckSquare size={12} strokeWidth={1.6} /> Task</span>
                    <span><MessageSquare size={12} strokeWidth={1.6} /> Messaggi</span>
                  </div>
                </>
              ) : (
                <p>Nessun risultato trovato per "{query}"</p>
              )}
            </div>
          ) : (
            flattenedResults.map((item, index) => (
              <div
                key={`${item.type}-${item.data.id}`}
                className={`search-overlay__item ${index === selectedIndex ? 'is-selected' : ''}`}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => handleSelect(item)}
              >
                <div className="search-overlay__item-icon">
                  {item.type === 'contact' && <User size={18} strokeWidth={1.6} />}
                  {item.type === 'folder' && <Hash size={18} strokeWidth={1.6} />}
                  {item.type === 'task' && <CheckSquare size={18} strokeWidth={1.6} />}
                  {item.type === 'message' && <MessageSquare size={18} strokeWidth={1.6} />}
                </div>
                <div className="search-overlay__item-info">
                  <div className="search-overlay__item-title">
                    {item.type === 'contact' && (item.data.name || item.data.push_name || item.data.phone_number)}
                    {item.type === 'folder' && item.data.name}
                    {item.type === 'task' && item.data.title}
                    {item.type === 'message' && item.data.contact_name}
                  </div>
                  <div className="search-overlay__item-subtitle">
                    {item.type === 'message' && item.data.body}
                    {item.type === 'task' && (item.data.status === 'todo' ? 'Da fare' : item.data.status === 'in-progress' ? 'In corso' : 'Completato')}
                    {item.type === 'contact' && item.data.phone_number}
                  </div>
                </div>
                <div className="search-overlay__item-meta">
                  {item.type === 'message' && (
                    <span className="search-overlay__item-date">
                      {new Date(item.data.timestamp * 1000).toLocaleDateString()}
                    </span>
                  )}
                  {index === selectedIndex && <kbd className="search-overlay__kbd">↵</kbd>}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="search-overlay__footer">
          <div className="search-overlay__footer-item">
            <kbd>↑↓</kbd> Naviga
          </div>
          <div className="search-overlay__footer-item">
            <kbd>↵</kbd> Seleziona
          </div>
          <div className="search-overlay__footer-item">
            <kbd>ESC</kbd> Chiudi
          </div>
        </div>
      </div>
    </div>
  )
}

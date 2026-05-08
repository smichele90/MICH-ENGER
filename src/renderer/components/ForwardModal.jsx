import React, { useState, useEffect, useMemo } from 'react'
import { X, Search, Send } from 'lucide-react'

export default function ForwardModal({ waSerializedId, accountId, onClose }) {
  const [contacts, setContacts] = useState([])
  const [groups, setGroups] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      const [c, g] = await Promise.all([
        window.api.getContacts(accountId),
        window.api.getGroups(accountId)
      ])
      setContacts(c || [])
      setGroups(g || [])
    }
    load()
  }, [accountId])

  const allTargets = useMemo(() => [...contacts, ...groups], [contacts, groups])

  const filtered = useMemo(() => {
    if (!search.trim()) return allTargets
    const q = search.toLowerCase()
    return allTargets.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.push_name || '').toLowerCase().includes(q) ||
      (c.phone_number || '').toLowerCase().includes(q)
    )
  }, [allTargets, search])

  const handleForward = async () => {
    if (!selected) return
    setSending(true)
    setError(null)
    try {
      const result = await window.api.forwardMessage(accountId, waSerializedId, selected.whatsapp_id)
      if (result?.success) {
        onClose()
      } else {
        setError(result?.error || 'Errore durante l\'inoltro')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const getDisplayName = (c) =>
    c.name || c.push_name || c.phone_number || c.whatsapp_id?.split('@')[0] || '?'

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ minWidth: 380, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal__header">
          <span className="modal__title">Inoltra <em>messaggio</em></span>
          <button className="chat-input-btn" onClick={onClose}><X size={18} strokeWidth={1.6} /></button>
        </div>

        <div className="sidebar__search-wrapper" style={{ marginBottom: 12 }}>
          <Search size={14} className="sidebar__search-icon" strokeWidth={1.6} />
          <input
            className="sidebar__search-input"
            placeholder="Cerca contatto o gruppo..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 16 }}>
              Nessun risultato
            </div>
          )}
          {filtered.map(c => {
            const isChosen = selected?.id === c.id
            return (
              <div
                key={c.id}
                className={`sidebar-item ${isChosen ? 'sidebar-item--active' : ''}`}
                onClick={() => setSelected(isChosen ? null : c)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span className="sidebar-item__label">{getDisplayName(c)}</span>
                {c.is_group ? (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gruppo</span>
                ) : null}
              </div>
            )
          })}
        </div>

        {error && (
          <div style={{ color: 'var(--text-danger, #e53e3e)', fontSize: 13, padding: '8px 0' }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn--ghost" onClick={onClose}>Annulla</button>
          <button
            className="btn btn--primary"
            onClick={handleForward}
            disabled={!selected || sending}
          >
            <Send size={14} style={{ marginRight: 6 }} strokeWidth={1.6} />
            {sending ? 'Inoltro...' : 'Inoltra'}
          </button>
        </div>
      </div>
    </div>
  )
}

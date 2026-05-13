import React, { useEffect, useMemo, useState } from 'react'
import { X, Search, Folder, User, Users, Check, Plus, Minus } from 'lucide-react'

/**
 * Modal per gestire i contatti di una cartella.
 * Mostra a sinistra i contatti già nella cartella, a destra i candidati selezionabili.
 *
 * Props:
 *  - folder: { id, name, color }
 *  - accountId
 *  - onClose
 *  - onChanged?
 */
export default function FolderContactManager({ folder, accountId, onClose, onChanged }) {
  const [members, setMembers] = useState([])
  const [allContacts, setAllContacts] = useState([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!folder || !accountId) return
    refresh()
  }, [folder?.id, accountId])

  const refresh = async () => {
    const m = await window.api.getFolderMembers(folder.id)
    setMembers(m)
    const c = await window.api.getContacts(accountId)
    const g = await window.api.getGroups(accountId)
    setAllContacts([...c, ...g])
  }

  const memberIds = useMemo(() => new Set(members.map(m => m.id)), [members])

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allContacts
      .filter(c => !memberIds.has(c.id))
      .filter(c => {
        if (!q) return true
        const hay = `${c.name || ''} ${c.push_name || ''} ${c.phone_number || ''}`.toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 200)
  }, [allContacts, memberIds, query])

  const add = async (contactId) => {
    setBusy(true)
    await window.api.addFolderMember(folder.id, contactId)
    await refresh()
    setBusy(false)
    onChanged?.()
  }

  const remove = async (contactId) => {
    setBusy(true)
    await window.api.removeFolderMember(folder.id, contactId)
    await refresh()
    setBusy(false)
    onChanged?.()
  }

  if (!folder) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 760, maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal__header">
          <span className="modal__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Folder size={18} color={folder.color || 'var(--accent)'} strokeWidth={1.6} />
            Gestione cartella · {folder.name}
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
              ({members.length} contatti)
            </span>
          </span>
          <button className="btn--icon" onClick={onClose}><X size={20} strokeWidth={1.6} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, flex: 1, minHeight: 0 }}>
          {/* MEMBRI */}
          <div style={colStyle}>
            <div style={colHeader}>
              <Check size={14} color="var(--success)" strokeWidth={1.6} /> Nella cartella
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{members.length}</span>
            </div>
            <div style={listStyle}>
              {members.length === 0 ? (
                <div style={emptyText}>Nessun contatto. Aggiungine dalla colonna a destra.</div>
              ) : (
                members.map(c => (
                  <Row key={c.id} contact={c}>
                    <button className="btn--icon" disabled={busy} title="Rimuovi" onClick={() => remove(c.id)}>
                      <Minus size={14} strokeWidth={1.6} />
                    </button>
                  </Row>
                ))
              )}
            </div>
          </div>

          {/* CANDIDATI */}
          <div style={colStyle}>
            <div style={colHeader}>
              <Search size={14} strokeWidth={1.6} /> Aggiungi contatti
            </div>
            <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
              <input
                className="chat-input"
                placeholder="Cerca per nome o numero..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                style={{ height: 32 }}
              />
            </div>
            <div style={listStyle}>
              {candidates.length === 0 ? (
                <div style={emptyText}>Nessun risultato.</div>
              ) : (
                candidates.map(c => (
                  <Row key={c.id} contact={c}>
                    <button className="btn--icon" disabled={busy} title="Aggiungi" onClick={() => add(c.id)}>
                      <Plus size={14} strokeWidth={1.6} />
                    </button>
                  </Row>
                ))
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn btn--ghost" onClick={onClose}>Chiudi</button>
        </div>
      </div>
    </div>
  )
}

function Row({ contact, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
      borderBottom: '1px solid var(--border)'
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 'var(--radius-md)', background: 'var(--accent-light)',
        color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
      }}>
        {contact.is_group ? <Users size={14} strokeWidth={1.6} /> : <User size={14} strokeWidth={1.6} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {contact.name || contact.push_name || contact.phone_number || '—'}
        </div>
        {contact.phone_number && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{contact.phone_number}</div>
        )}
      </div>
      {children}
    </div>
  )
}

const colStyle = {
  display: 'flex', flexDirection: 'column', minHeight: 0,
  border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden'
}
const colHeader = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 12px', background: 'var(--bg-secondary)',
  fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border)'
}
const listStyle = { flex: 1, overflowY: 'auto', minHeight: 200 }
const emptyText = { padding: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }

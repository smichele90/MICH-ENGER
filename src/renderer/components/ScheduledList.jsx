import React, { useState, useEffect } from 'react'
import { Clock, Trash2, Plus, Folder, Users, User, CheckCircle2, Edit2, Pause, Play } from 'lucide-react'
import ScheduleMessageModal from './ScheduleMessageModal'
import ConfirmDialog from './ConfirmDialog'

export default function ScheduledList({ accountId }) {
  const [messages, setMessages] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  useEffect(() => {
    if (!accountId) return
    loadMessages()
    const off = window.api.on?.('scheduled:updated', loadMessages)
    return () => off?.()
  }, [accountId])

  const loadMessages = async () => {
    if (!accountId) return
    setMessages(await window.api.getScheduled(accountId))
  }

  const handleDelete = (id) => setConfirmDeleteId(id)

  const confirmDelete = async () => {
    await window.api.deleteScheduled(confirmDeleteId)
    setConfirmDeleteId(null)
    loadMessages()
  }

  const handleToggleActive = async (msg) => {
    await window.api.updateScheduled(msg.id, { is_active: msg.is_active ? 0 : 1 })
    loadMessages()
  }

  const handleEdit = (msg) => {
    setEditing(msg)
    setShowModal(true)
  }

  const handleNew = () => {
    setEditing(null)
    setShowModal(true)
  }

  const targetIcon = (msg) => {
    if (msg.target_type === 'folder') return <Folder size={16} color="var(--accent)" strokeWidth={1.6} />
    if (msg.target_type === 'group') return <Users size={16} color="var(--accent)" strokeWidth={1.6} />
    return <User size={16} color="var(--accent)" strokeWidth={1.6} />
  }

  const formatNext = (msg) => {
    const d = new Date(msg.next_send_at || msg.scheduled_at)
    return d.toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="main-header">
        <div className="main-header__info">
          <div className="main-header__name">🕒 Messaggi <span className="t-sub">Programmati</span></div>
        </div>
        <button className="btn btn--primary" onClick={handleNew}>
          <Plus size={14} strokeWidth={1.6} /> Programma Messaggio
        </button>
      </div>

      <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
        {messages.length === 0 ? (
          <div className="empty-state">
            <Clock size={48} color="var(--text-muted)" style={{ opacity: 0.3 }} strokeWidth={1.6} />
            <p>Nessun messaggio programmato.</p>
            <button className="btn btn--primary" onClick={handleNew} style={{ marginTop: 12 }}>
              <Plus size={14} strokeWidth={1.6} /> Crea il primo
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {messages.map(msg => (
              <div key={msg.id} style={{
                background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', padding: 16,
                border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10,
                opacity: msg.is_active ? 1 : 0.55
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    {targetIcon(msg)}
                    <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {msg.target_name || `${msg.target_type} #${msg.target_id}`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn--icon" title={msg.is_active ? 'Sospendi' : 'Riattiva'} onClick={() => handleToggleActive(msg)}>
                      {msg.is_active ? <Pause size={14} strokeWidth={1.6} /> : <Play size={14} strokeWidth={1.6} />}
                    </button>
                    <button className="btn--icon" title="Modifica" onClick={() => handleEdit(msg)}>
                      <Edit2 size={14} strokeWidth={1.6} />
                    </button>
                    <button className="btn--icon" title="Elimina" onClick={() => handleDelete(msg.id)}>
                      <Trash2 size={14} strokeWidth={1.6} />
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 100, overflow: 'hidden' }}>
                  {msg.body}
                </div>

                <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {msg.last_sent_at ? <CheckCircle2 size={12} color="var(--success)" strokeWidth={1.6} /> : <Clock size={12} color="var(--warning)" strokeWidth={1.6} />}
                    {formatNext(msg)}
                  </div>
                  {msg.recurrence_type !== 'once' && <span>♻️ {msg.recurrence_type}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <ScheduleMessageModal
          accountId={accountId}
          editing={editing}
          onClose={() => { setShowModal(false); setEditing(null) }}
          onSaved={loadMessages}
        />
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          message="Eliminare questo messaggio programmato?"
          confirmLabel="Elimina"
          onConfirm={confirmDelete}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  )
}

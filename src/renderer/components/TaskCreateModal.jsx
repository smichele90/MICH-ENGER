import React, { useState } from 'react'
import { X, Calendar, Bell, Repeat, Save } from 'lucide-react'

export default function TaskCreateModal({ initialData, onClose, onCreated }) {
  const [title, setTitle] = useState(initialData?.title || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [dueDate, setDueDate] = useState('')
  const [notify, setNotify] = useState(false)
  const [notifyAt, setNotifyAt] = useState('')
  const [recurrence, setRecurrence] = useState('once')

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const task = {
        title,
        description,
        status: 'todo',
        priority: 'medium',
        due_date: dueDate || null,
        notify: notify ? 1 : 0,
        notify_at: notifyAt || null,
        recurrence_type: recurrence,
        source_message_id: initialData?.source_message_id || null
      }
      const result = await window.api.createTask(task)
      onCreated({ id: result.id, ...task })
      onClose()
    } catch (err) {
      console.error('Errore creazione task:', err)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 500 }}>
        <div className="modal__header">
          <span className="modal__title">Crea Nuovo Task</span>
          <button className="btn--icon" onClick={onClose}><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="form-group">
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Titolo</label>
            <input
              type="text"
              className="sidebar__search-input"
              style={{ paddingLeft: 12 }}
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Descrizione</label>
            <textarea
              className="chat-input"
              style={{ minHeight: 80, padding: 10 }}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                <Calendar size={14} /> Scadenza
              </label>
              <input
                type="datetime-local"
                className="sidebar__search-input"
                style={{ paddingLeft: 12 }}
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                <Repeat size={14} /> Ricorrenza
              </label>
              <select
                className="sidebar__search-input"
                style={{ paddingLeft: 12, appearance: 'none' }}
                value={recurrence}
                onChange={e => setRecurrence(e.target.value)}
              >
                <option value="once">Solo una volta</option>
                <option value="daily">Giornaliero</option>
                <option value="weekly">Settimanale</option>
                <option value="monthly">Mensile</option>
              </select>
            </div>
          </div>

          <div className="form-group" style={{ background: 'var(--bg-secondary)', padding: 12, borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                id="create-notify-checkbox"
                type="checkbox"
                checked={notify}
                onChange={e => setNotify(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <Bell size={14} style={{ color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <label htmlFor="create-notify-checkbox" style={{ fontSize: 14, fontWeight: 500, cursor: 'pointer', margin: 0 }}>
                Abilita Notifica
              </label>
            </div>
            {notify && (
              <input
                type="datetime-local"
                className="sidebar__search-input"
                style={{ paddingLeft: 12, marginTop: 10 }}
                value={notifyAt}
                onChange={e => setNotifyAt(e.target.value)}
                required={notify}
              />
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annulla</button>
            <button type="submit" className="btn btn--primary">
              <Save size={16} /> Salva Task
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

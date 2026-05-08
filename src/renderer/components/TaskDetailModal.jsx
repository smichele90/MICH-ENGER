import React, { useEffect, useState } from 'react'
import { X, Save, Calendar, Bell, Repeat, Flag, Tag, Trash2, Plus, ExternalLink } from 'lucide-react'
import ConfirmDialog from './ConfirmDialog'

const PRIORITIES = [
  { v: 'low',    label: 'Bassa',  color: '#6b8a5e' },
  { v: 'medium', label: 'Media',  color: '#b8763a' },
  { v: 'high',   label: 'Alta',   color: '#9a4f3f' }
]

const STATUSES = [
  { v: 'todo',        label: 'Da fare' },
  { v: 'in_progress', label: 'In corso' },
  { v: 'done',        label: 'Completato' },
  { v: 'archived',    label: 'Archiviato' }
]

const RECURRENCES = [
  { v: 'once',    label: 'Mai' },
  { v: 'daily',   label: 'Giornaliera' },
  { v: 'weekly',  label: 'Settimanale' },
  { v: 'monthly', label: 'Mensile' }
]

/**
 * Modal di dettaglio/editing di un task esistente.
 * Props: task, onClose, onSaved, onDeleted
 */
export default function TaskDetailModal({ task, onClose, onSaved, onDeleted, onNavigateToMessage }) {
  const [form, setForm] = useState({
    title: task.title || '',
    description: task.description || '',
    status: task.status || 'todo',
    priority: task.priority || '',
    due_date: task.due_date ? toLocalInput(task.due_date) : '',
    notify: !!task.notify,
    notify_at: task.notify_at ? toLocalInput(task.notify_at) : '',
    recurrence_type: task.recurrence_type || 'once'
  })
  const [labels, setLabels] = useState([])
  const [allLabels, setAllLabels] = useState([])
  const [showLabelPicker, setShowLabelPicker] = useState(false)
  const [newLabel, setNewLabel] = useState({ name: '', color: '#8b6f47' })
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)

  useEffect(() => {
    refreshLabels()
  }, [task.id])

  const refreshLabels = async () => {
    setLabels(await window.api.getTaskLabels(task.id))
    setAllLabels(await window.api.getAllLabels())
  }

  const handleSave = async () => {
    if (!form.title.trim()) return
    const payload = {
      title: form.title.trim(),
      description: form.description,
      status: form.status,
      priority: form.priority || null,
      due_date: form.due_date ? new Date(form.due_date).toISOString() : null,
      notify: form.notify ? 1 : 0,
      notify_at: form.notify_at ? new Date(form.notify_at).toISOString() : null,
      recurrence_type: form.recurrence_type
    }
    await window.api.updateTask(task.id, payload)
    onSaved?.()
    onClose()
  }

  const handleDelete = () => setShowConfirmDelete(true)

  const confirmDelete = async () => {
    await window.api.deleteTask(task.id)
    onDeleted?.()
    onClose()
  }

  const toggleLabel = async (label) => {
    const has = labels.some(l => l.id === label.id)
    if (has) await window.api.unassignLabel(task.id, label.id)
    else await window.api.assignLabel(task.id, label.id)
    refreshLabels()
  }

  const handleCreateLabel = async () => {
    if (!newLabel.name.trim()) return
    const r = await window.api.createLabel({ name: newLabel.name.trim(), color: newLabel.color })
    if (r?.id) await window.api.assignLabel(task.id, r.id)
    setNewLabel({ name: '', color: '#8b6f47' })
    refreshLabels()
  }

  return (
    <>
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 600, maxHeight: '90vh', overflow: 'auto' }}>
        <div className="modal__header">
          <span className="modal__title">Dettaglio <em>Task</em></span>
          <button className="btn--icon" onClick={onClose}><X size={20} strokeWidth={1.6} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={lbl}>Titolo</label>
            <input className="chat-input" value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>

          <div>
            <label style={lbl}>Descrizione</label>
            <textarea className="chat-input" rows={4} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Stato</label>
              <select className="chat-input" value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUSES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}><Flag size={12} strokeWidth={1.6} /> Priorità</label>
              <select className="chat-input" value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                <option value="">Nessuna</option>
                {PRIORITIES.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}><Calendar size={12} strokeWidth={1.6} /> Scadenza</label>
              <input type="datetime-local" className="chat-input" value={form.due_date}
                onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}><Repeat size={12} strokeWidth={1.6} /> Ricorrenza</label>
              <select className="chat-input" value={form.recurrence_type}
                onChange={e => setForm(f => ({ ...f, recurrence_type: e.target.value }))}>
                {RECURRENCES.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ background: 'var(--bg-secondary)', padding: 12, borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                id="task-notify-checkbox"
                type="checkbox"
                checked={form.notify}
                onChange={e => setForm(f => ({ ...f, notify: e.target.checked }))}
                style={{ cursor: 'pointer' }}
              />
              <Bell size={14} style={{ color: 'var(--text-muted)', pointerEvents: 'none' }} strokeWidth={1.6} />
              <label htmlFor="task-notify-checkbox" style={{ fontSize: 13, cursor: 'pointer', margin: 0 }}>
                Notifica desktop
              </label>
            </div>
            {form.notify && (
              <input type="datetime-local" className="chat-input" style={{ marginTop: 8 }}
                value={form.notify_at}
                onChange={e => setForm(f => ({ ...f, notify_at: e.target.value }))} />
            )}
          </div>

          {/* Labels */}
          <div>
            <label style={lbl}><Tag size={12} strokeWidth={1.6} /> Etichette</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              {labels.map(l => (
                <span key={l.id} onClick={() => toggleLabel(l)}
                  style={{ ...labelChip, background: l.color + '22', color: l.color, cursor: 'pointer' }}
                  title="Rimuovi">
                  {l.name} ✕
                </span>
              ))}
              <button className="btn btn--ghost" type="button" onClick={() => setShowLabelPicker(s => !s)}
                style={{ fontSize: 11, padding: '2px 8px' }}>
                <Plus size={12} strokeWidth={1.6} /> Etichetta
              </button>
            </div>
            {showLabelPicker && (
              <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {allLabels.filter(l => !labels.some(x => x.id === l.id)).map(l => (
                    <span key={l.id} onClick={() => toggleLabel(l)}
                      style={{ ...labelChip, background: l.color + '22', color: l.color, cursor: 'pointer' }}>
                      + {l.name}
                    </span>
                  ))}
                  {allLabels.length === 0 && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Nessuna etichetta. Creane una qui sotto.</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="chat-input" placeholder="Nuova etichetta..."
                    value={newLabel.name}
                    onChange={e => setNewLabel(n => ({ ...n, name: e.target.value }))}
                    style={{ flex: 1, height: 30 }} />
                  <input type="color" value={newLabel.color}
                    onChange={e => setNewLabel(n => ({ ...n, color: e.target.value }))}
                    style={{ width: 36, height: 30, border: 'none', background: 'none', cursor: 'pointer' }} />
                  <button className="btn btn--primary" type="button" onClick={handleCreateLabel}
                    style={{ padding: '0 10px' }}><Plus size={14} strokeWidth={1.6} /></button>
                </div>
              </div>
            )}
          </div>

          {task.source_message_id && (
            <button
              onClick={() => onNavigateToMessage?.(task.source_message_id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                borderLeft: '3px solid var(--accent)', borderRadius: '0 6px 6px 0',
                padding: '8px 12px', cursor: 'pointer', textAlign: 'left'
              }}
            >
              <ExternalLink size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} strokeWidth={1.6} />
              <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>
                Vai al messaggio originale
              </span>
            </button>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <button className="btn btn--danger" type="button" onClick={handleDelete}>
              <Trash2 size={14} strokeWidth={1.6} /> Elimina
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn--ghost" type="button" onClick={onClose}>Annulla</button>
              <button className="btn btn--primary" type="button" onClick={handleSave}>
                <Save size={14} strokeWidth={1.6} /> Salva
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    {showConfirmDelete && (
      <ConfirmDialog
        message="Eliminare definitivamente questo task?"
        confirmLabel="Elimina"
        onConfirm={confirmDelete}
        onCancel={() => setShowConfirmDelete(false)}
      />
    )}
    </>
  )
}

const lbl = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }
const labelChip = { padding: '3px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }

function toLocalInput(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

import React, { useEffect, useRef, useState } from 'react'
import { CheckSquare, X, Save } from 'lucide-react'

export default function MessageToTask({ message, anchorRect, onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState(message?.body || '')
  const [priority, setPriority] = useState('medium')
  const [dueDate, setDueDate] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const W = 380, H = 360
  const popoverStyle = (() => {
    if (!anchorRect) return { position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 1500 }
    const spaceBelow = window.innerHeight - anchorRect.bottom - 8
    const top = spaceBelow >= H
      ? anchorRect.bottom + 8
      : Math.max(8, anchorRect.top - H - 8)
    const left = Math.min(Math.max(8, anchorRect.right - W), window.innerWidth - W - 8)
    return { position: 'fixed', top, left, zIndex: 1500 }
  })()

  const handleSave = async () => {
    if (!title.trim()) return
    const payload = {
      title: title.trim(),
      description: description.trim(),
      status: 'todo',
      priority,
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
      source_message_id: typeof message?.id === 'number' ? message.id : null
    }
    const r = await window.api.createTask(payload)
    onCreated?.({ id: r.id, ...payload })
    onClose()
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1499 }} />
      <div
        onClick={e => e.stopPropagation()}
        style={{
          ...popoverStyle,
          width: W, background: 'var(--bg-modal)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', padding: 16, boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column', gap: 12
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            <CheckSquare size={15} style={{ color: 'var(--accent)' }} strokeWidth={1.6} /> Crea task
          </div>
          <button className="btn--icon" style={{ width: 24, height: 24 }} onClick={onClose}>
            <X size={13} strokeWidth={1.6} />
          </button>
        </div>

        {/* Titolo */}
        <div>
          <label style={lbl}>Titolo *</label>
          <input
            ref={inputRef}
            className="chat-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose() }}
            placeholder="Scrivi il titolo"
          />
        </div>

        {/* Descrizione (dal messaggio, modificabile) */}
        <div>
          <label style={lbl}>Descrizione (dal messaggio)</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') onClose() }}
            placeholder="Descrizione del task…"
            style={{
              width: '100%',
              fontFamily: 'inherit',
              fontSize: 12,
              color: 'var(--text-primary)',
              lineHeight: 1.45,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderLeft: '3px solid var(--accent)',
              borderRadius: '0 6px 6px 0',
              padding: '7px 10px',
              minHeight: 60,
              maxHeight: 140,
              resize: 'vertical',
              outline: 'none'
            }}
          />
        </div>

        {/* Priorità + Scadenza */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={lbl}>Priorità</label>
            <select className="chat-input" value={priority} onChange={e => setPriority(e.target.value)} style={{ fontSize: 12 }}>
              <option value="low">🔵 Bassa</option>
              <option value="medium">🟡 Media</option>
              <option value="high">🔴 Alta</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Scadenza</label>
            <input type="datetime-local" className="chat-input" value={dueDate}
              onChange={e => setDueDate(e.target.value)} style={{ fontSize: 11 }} />
          </div>
        </div>

        {/* Salva */}
        <button className="btn btn--primary" onClick={handleSave} disabled={!title.trim()}
          style={{ width: '100%', height: 34, marginTop: 2 }}>
          <Save size={14} strokeWidth={1.6} /> Salva task
        </button>
      </div>
    </>
  )
}

const lbl = { fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }

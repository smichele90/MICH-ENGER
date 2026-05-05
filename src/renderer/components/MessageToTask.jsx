import React, { useEffect, useRef, useState } from 'react'
import { CheckSquare, X, Save } from 'lucide-react'

/**
 * Popover di quick-create di un task partendo da un messaggio.
 * Bidirezionale: il task viene salvato con `source_message_id` puntato
 * all'id locale del messaggio, in modo che il task ne mostri il link.
 *
 * Props:
 *  - message: { id, body, wa_message_id }
 *  - anchorRect?: DOMRect | null   (posizionamento)
 *  - onClose
 *  - onCreated
 */
export default function MessageToTask({ message, anchorRect, onClose, onCreated }) {
  const [title, setTitle] = useState((message?.body || '').slice(0, 80))
  const [priority, setPriority] = useState('medium')
  const [dueDate, setDueDate] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Posizionamento: se anchorRect, posiziona vicino; altrimenti centra in alto
  const popoverStyle = anchorRect
    ? {
        position: 'fixed',
        top: Math.min(anchorRect.bottom + 6, window.innerHeight - 280),
        left: Math.min(anchorRect.left, window.innerWidth - 360),
        zIndex: 1500
      }
    : {
        position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 1500
      }

  const handleSave = async () => {
    if (!title.trim()) return
    const payload = {
      title: title.trim(),
      description: message?.body || '',
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
      <div style={{
        ...popoverStyle,
        width: 340, background: 'var(--bg-modal)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)', padding: 12, boxShadow: 'var(--shadow-md)',
        display: 'flex', flexDirection: 'column', gap: 8
      }}
      onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
          <CheckSquare size={14} /> Crea task da messaggio
          <button className="btn--icon" style={{ marginLeft: 'auto', width: 22, height: 22 }} onClick={onClose}>
            <X size={12} />
          </button>
        </div>

        <input ref={inputRef} className="chat-input" value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose() }}
          placeholder="Titolo task..." style={{ height: 32 }} />

        <div style={{ display: 'flex', gap: 6 }}>
          <select className="chat-input" value={priority}
            onChange={e => setPriority(e.target.value)}
            style={{ flex: 1, height: 30, fontSize: 12 }}>
            <option value="low">Bassa</option>
            <option value="medium">Media</option>
            <option value="high">Alta</option>
          </select>
          <input type="datetime-local" className="chat-input" value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            style={{ flex: 1.4, height: 30, fontSize: 11 }} />
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-muted)', maxHeight: 50, overflow: 'hidden' }}>
          📎 {(message?.body || '').slice(0, 100)}{(message?.body || '').length > 100 ? '…' : ''}
        </div>

        <button className="btn btn--primary" onClick={handleSave} disabled={!title.trim()}
          style={{ height: 32 }}>
          <Save size={14} /> Crea task
        </button>
      </div>
    </>
  )
}

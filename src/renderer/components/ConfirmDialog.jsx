import React from 'react'
import { AlertTriangle } from 'lucide-react'

export default function ConfirmDialog({ message, confirmLabel = 'Conferma', cancelLabel = 'Annulla', onConfirm, onCancel, danger = true }) {
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="modal" style={{ width: 380 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
          <AlertTriangle size={22} color="var(--warning)" style={{ flexShrink: 0, marginTop: 2 }} strokeWidth={1.6} />
          <p style={{ fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.5 }}>{message}</p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn--ghost" onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

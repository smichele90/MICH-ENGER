import React, { useEffect, useState, useMemo, useRef } from 'react'
import { X, Send, Eye, Folder, User, Users, Clock, Repeat, AlertTriangle, Search, ChevronDown } from 'lucide-react'

const RECURRENCE_OPTS = [
  { value: 'once',    label: 'Una volta sola' },
  { value: 'daily',   label: 'Ogni giorno' },
  { value: 'weekly',  label: 'Ogni settimana' },
  { value: 'monthly', label: 'Ogni mese' },
  { value: 'custom',  label: 'Personalizzato (cron)' }
]

function SearchableSelect({ value, options, placeholder, onChange }) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef(null)
  const searchRef = useRef(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return options
    const q = search.toLowerCase()
    return options.filter(o =>
      o.name?.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q)
    )
  }, [options, search])

  const selected = options.find(o => String(o.id) === String(value))

  useEffect(() => {
    if (!isOpen) { setSearch(''); return }
    searchRef.current?.focus()
    function handleMouseDown(e) {
      if (!containerRef.current?.contains(e.target)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [isOpen])

  const handleSelect = (id) => {
    onChange(String(id))
    setIsOpen(false)
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        type="button"
        className="chat-input"
        onClick={() => setIsOpen(v => !v)}
        style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ color: selected ? 'var(--text-primary)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.name : placeholder}
        </span>
        <ChevronDown size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8, transform: isOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--bg-modal)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow)',
          zIndex: 200, overflow: 'hidden'
        }}>
          {/* Search input */}
          <div style={{ padding: '8px', borderBottom: '1px solid var(--border-light)', position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              ref={searchRef}
              className="chat-input"
              style={{ paddingLeft: 30, padding: '6px 10px 6px 30px', fontSize: 13 }}
              placeholder="Cerca..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {/* List */}
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 13 }}>Nessun risultato</div>
            ) : filtered.map(t => (
              <div
                key={t.id}
                className={`sidebar-item ${String(value) === String(t.id) ? 'sidebar-item--active' : ''}`}
                onClick={() => handleSelect(t.id)}
                style={{ padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              >
                <span style={{ fontSize: 13, fontWeight: String(value) === String(t.id) ? 600 : 400 }}>{t.name}</span>
                {t.hint && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8, flexShrink: 0 }}>{t.hint}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ScheduleMessageModal({ accountId, initialContact, editing, onClose, onSaved }) {
  const [contacts, setContacts] = useState([])
  const [folders, setFolders] = useState([])
  const [folderCounts, setFolderCounts] = useState({})

  const [form, setForm] = useState(() => ({
    target_type: editing?.target_type || (initialContact ? (initialContact.is_group ? 'group' : 'contact') : 'contact'),
    target_id: editing?.target_id ?? initialContact?.id ?? '',
    body: editing?.body || '',
    scheduled_at: editing?.scheduled_at ? toLocalInput(editing.scheduled_at) : defaultDateTime(),
    recurrence_type: editing?.recurrence_type || 'once',
    recurrence_rule: editing?.recurrence_rule || ''
  }))

  useEffect(() => {
    if (!accountId) return
    ;(async () => {
      const c = await window.api.getContacts(accountId)
      const g = await window.api.getGroups(accountId)
      setContacts([...c, ...g])
      const f = await window.api.getFolders()
      setFolders(f)
      const counts = {}
      for (const folder of f) {
        const m = await window.api.getFolderMembers(folder.id)
        counts[folder.id] = m.length
      }
      setFolderCounts(counts)
    })()
  }, [accountId])

  const targetList = useMemo(() => {
    if (form.target_type === 'folder') {
      return folders.map(f => ({ id: f.id, name: f.name, hint: `${folderCounts[f.id] ?? 0} contatti` }))
    }
    const filtered = form.target_type === 'group'
      ? contacts.filter(c => c.is_group)
      : contacts.filter(c => !c.is_group)
    return filtered.map(c => ({ id: c.id, name: c.name || c.push_name || c.phone_number, hint: c.phone_number || '' }))
  }, [form.target_type, contacts, folders, folderCounts])

  const selectedTargetName = useMemo(() => {
    const t = targetList.find(x => String(x.id) === String(form.target_id))
    return t?.name || ''
  }, [form.target_id, targetList])

  const isValid = form.target_id && form.body.trim() && form.scheduled_at &&
    (form.recurrence_type !== 'custom' || form.recurrence_rule.trim())

  const willSendInPast = useMemo(() => {
    if (!form.scheduled_at) return false
    return new Date(form.scheduled_at) < new Date()
  }, [form.scheduled_at])

  const handleSave = async () => {
    if (!isValid) return
    const targetIdNum = parseInt(form.target_id, 10)
    if (Number.isNaN(targetIdNum)) {
      alert('Destinatario non valido. Riselezionalo dalla lista.')
      return
    }
    const dt = new Date(form.scheduled_at)
    if (Number.isNaN(dt.getTime())) {
      alert('Data/ora non valida.')
      return
    }
    const payload = {
      account_id: accountId,
      target_type: form.target_type,
      target_id: targetIdNum,
      target_name: selectedTargetName,
      body: form.body,
      scheduled_at: dt.toISOString(),
      next_send_at: dt.toISOString(),
      recurrence_type: form.recurrence_type,
      recurrence_rule: form.recurrence_type === 'custom' ? form.recurrence_rule : null
    }
    if (editing?.id) {
      await window.api.updateScheduled(editing.id, payload)
    } else {
      await window.api.createScheduled(payload)
    }
    onSaved?.()
    onClose()
  }

  const targetIcon = form.target_type === 'folder' ? <Folder size={16} /> : (form.target_type === 'group' ? <Users size={16} /> : <User size={16} />)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 560, maxHeight: '90vh', overflow: 'auto' }}>
        <div className="modal__header">
          <span className="modal__title">{editing ? 'Modifica messaggio programmato' : 'Programma messaggio'}</span>
          <button className="btn--icon" onClick={onClose}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Target type */}
          <div>
            <label style={lblStyle}>Destinatario</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { v: 'contact', label: 'Contatto', icon: <User size={14} /> },
                { v: 'group',   label: 'Gruppo',   icon: <Users size={14} /> },
                { v: 'folder',  label: 'Cartella', icon: <Folder size={14} /> }
              ].map(opt => (
                <button
                  key={opt.v}
                  className={`btn ${form.target_type === opt.v ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => setForm(f => ({ ...f, target_type: opt.v, target_id: '' }))}
                  type="button"
                  style={{ flex: 1 }}
                >
                  {opt.icon} {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Target combobox */}
          <div>
            <label style={lblStyle}>
              Seleziona {form.target_type === 'folder' ? 'cartella' : (form.target_type === 'group' ? 'gruppo' : 'contatto')}
            </label>
            <SearchableSelect
              value={form.target_id}
              options={targetList}
              placeholder="— Seleziona —"
              onChange={id => setForm(f => ({ ...f, target_id: id }))}
            />
          </div>

          {/* Body */}
          <div>
            <label style={lblStyle}>Messaggio</label>
            <textarea className="chat-input" rows={5} placeholder="Scrivi il messaggio..."
              value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {form.body.length} caratteri
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lblStyle}><Clock size={12} /> Data e ora</label>
              <input type="datetime-local" className="chat-input"
                value={form.scheduled_at}
                onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))} />
            </div>
            <div>
              <label style={lblStyle}><Repeat size={12} /> Ricorrenza</label>
              <select className="chat-input" value={form.recurrence_type}
                onChange={e => setForm(f => ({ ...f, recurrence_type: e.target.value }))}>
                {RECURRENCE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {form.recurrence_type === 'custom' && (
            <div>
              <label style={lblStyle}>Cron expression (es. <code>0 9 * * 1</code> = lunedì alle 09:00)</label>
              <input className="chat-input" placeholder="min hour day month dow"
                value={form.recurrence_rule}
                onChange={e => setForm(f => ({ ...f, recurrence_rule: e.target.value }))} />
            </div>
          )}

          {willSendInPast && form.recurrence_type === 'once' && (
            <div style={warnBox}>
              <AlertTriangle size={14} /> La data è nel passato: il messaggio non verrà inviato.
            </div>
          )}

          {/* Anteprima */}
          {form.body && form.target_id && (
            <div style={previewBox}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Eye size={12} /> ANTEPRIMA
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13 }}>
                {targetIcon} <strong>{selectedTargetName || '—'}</strong>
              </div>
              <div style={{
                background: 'var(--accent)', color: 'white', padding: '8px 12px',
                borderRadius: 12, borderTopRightRadius: 4, alignSelf: 'flex-end', maxWidth: '90%',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13
              }}>
                {form.body}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                Invio: {form.scheduled_at ? new Date(form.scheduled_at).toLocaleString('it-IT') : '—'}
                {form.recurrence_type !== 'once' && ` · ${RECURRENCE_OPTS.find(o => o.value === form.recurrence_type)?.label}`}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annulla</button>
            <button type="button" className="btn btn--primary" disabled={!isValid} onClick={handleSave}>
              <Send size={14} /> {editing ? 'Salva modifiche' : 'Programma'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const lblStyle = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }
const warnBox = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
  background: 'rgba(245,158,11,0.1)', border: '1px solid var(--warning)',
  color: 'var(--warning)', borderRadius: 8, fontSize: 12
}
const previewBox = {
  display: 'flex', flexDirection: 'column',
  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
  borderRadius: 8, padding: 12
}

function defaultDateTime() {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setSeconds(0, 0)
  return toLocalInput(d.toISOString())
}

function toLocalInput(iso) {
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

import React, { useEffect, useState, useMemo, useRef } from 'react'
import { X, Send, Eye, Folder, User, Users, Clock, Repeat, AlertTriangle, Search, ChevronDown, Paperclip, Mic, Square, Trash2, FileAudio, Image, FileText } from 'lucide-react'

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
    if (!isOpen) return
    searchRef.current?.focus()
    function handleMouseDown(e) {
      if (!containerRef.current?.contains(e.target)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) setSearch('')
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
        <ChevronDown size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8, transform: isOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }} strokeWidth={1.6} />
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
            <Search size={13} style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} strokeWidth={1.6} />
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

function MentionSuggestions({ suggestions, activeIndex, onSelect }) {
  return (
    <div className="mention-suggestions">
      {suggestions.map((m, i) => (
        <div
          key={m.id}
          className={`mention-suggestions__item ${i === activeIndex ? 'mention-suggestions__item--active' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(m) }}
        >
          <span className="mention-suggestions__name">{m.name || m.push_name || m.phone_number}</span>
          {m.phone_number && <span className="mention-suggestions__phone">{m.phone_number}</span>}
        </div>
      ))}
    </div>
  )
}

export default function ScheduleMessageModal({ accountId, initialContact, editing, onClose, onSaved }) {
  const [contacts, setContacts] = useState([])
  const [folders, setFolders] = useState([])
  const [folderCounts, setFolderCounts] = useState({})
  const [formError, setFormError] = useState('')
  const [groupMembers, setGroupMembers] = useState([])
  const [mentionSuggestions, setMentionSuggestions] = useState([])
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const msgTextareaRef = useRef(null)
  const pendingMentionIdsRef = useRef(editing?.mentions_json ? JSON.parse(editing.mentions_json) : [])

  // Media attachment state
  const [mediaAttachments, setMediaAttachments] = useState(() => {
    if (editing?.media_paths_json) {
      try { return JSON.parse(editing.media_paths_json) } catch { /* fall through */ }
    }
    if (editing?.media_path) {
      return [{ path: editing.media_path, name: editing.media_path.split(/[\\/]/).pop(), type: editing.media_type || 'document' }]
    }
    return []
  })
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const recorderRef = useRef(null)
  const recChunksRef = useRef([])
  const recTimerRef = useRef(null)
  const fileInputRef = useRef(null)

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

  useEffect(() => {
    if (form.target_type === 'group' && form.target_id && accountId) {
      const grp = contacts.find(c => String(c.id) === String(form.target_id))
      if (grp?.whatsapp_id) {
        window.api.getGroupParticipants(accountId, grp.whatsapp_id)
          .then(members => setGroupMembers(members || []))
          .catch(() => setGroupMembers([]))
      } else {
        setGroupMembers([])
      }
    } else {
      setGroupMembers([])
      setMentionActive(false)
      setMentionSuggestions([])
    }
  }, [form.target_type, form.target_id, accountId, contacts])

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

  const detectType = (name) => {
    const ext = name.split('.').pop().toLowerCase()
    const imgExts = ['jpg','jpeg','png','gif','webp']
    const audioExts = ['mp3','ogg','wav','m4a','opus']
    const videoExts = ['mp4','mov','avi','mkv','webm']
    return imgExts.includes(ext) ? 'image' : audioExts.includes(ext) ? 'audio' : videoExts.includes(ext) ? 'video' : 'document'
  }

  const handlePickFiles = async () => {
    let filePaths = []
    if (typeof window.api.pickMediaFiles === 'function') {
      const res = await window.api.pickMediaFiles()
      if (!res || res.canceled) return
      filePaths = res.filePaths || []
    } else {
      const single = await window.api.pickMediaFile()
      if (!single) return
      filePaths = [single]
    }
    if (filePaths.length === 0) return
    const newItems = filePaths.map(fp => {
      const name = fp.split(/[\\/]/).pop()
      return { path: fp, name, type: detectType(name) }
    })
    setMediaAttachments(prev => [...prev, ...newItems])
  }

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferredMime = MediaRecorder.isTypeSupported('audio/ogg; codecs=opus')
        ? 'audio/ogg; codecs=opus'
        : 'audio/webm; codecs=opus'
      const recorder = new MediaRecorder(stream, { mimeType: preferredMime })
      recChunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) recChunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(recChunksRef.current, { type: recorder.mimeType })
        const buffer = new Uint8Array(await blob.arrayBuffer())
        const filePath = await window.api.saveRecording(buffer, recorder.mimeType)
        if (filePath) {
          const name = filePath.split(/[\\/]/).pop()
          setMediaAttachments(prev => [...prev, { path: filePath, name, type: 'audio' }])
        }
      }
      recorder.start()
      recorderRef.current = recorder
      setIsRecording(true)
      setRecordingSeconds(0)
      recTimerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000)
    } catch (err) {
      setFormError('Impossibile accedere al microfono: ' + err.message)
    }
  }

  const handleStopRecording = () => {
    clearInterval(recTimerRef.current)
    recorderRef.current?.stop()
    recorderRef.current = null
    setIsRecording(false)
  }

  const handleRemoveMedia = (index) => {
    setMediaAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const isValid = form.target_id && (form.body.trim() || mediaAttachments.length > 0) && form.scheduled_at &&
    (form.recurrence_type !== 'custom' || form.recurrence_rule.trim())

  const willSendInPast = useMemo(() => {
    if (!form.scheduled_at) return false
    return new Date(form.scheduled_at) < new Date()
  }, [form.scheduled_at])

  const handleBodyChange = (e) => {
    const val = e.target.value
    setForm(f => ({ ...f, body: val }))
    if (form.target_type === 'group' && groupMembers.length > 0) {
      const cursor = e.target.selectionStart
      const before = val.slice(0, cursor)
      const match = before.match(/@([^@\s]*)$/)
      if (match) {
        const q = match[1].toLowerCase()
        const filtered = groupMembers.filter(m => {
          const name = (m.name || m.push_name || '').toLowerCase()
          const phone = (m.phone_number || m.whatsapp_id?.split('@')[0] || '').toLowerCase()
          return name.includes(q) || phone.includes(q)
        })
        setMentionSuggestions(filtered.slice(0, 6))
        setMentionActive(filtered.length > 0)
        setMentionIndex(0)
      } else {
        setMentionActive(false)
        setMentionSuggestions([])
      }
    }
  }

  const insertMention = (member) => {
    const displayName = member.name || member.push_name || member.whatsapp_id.split('@')[0]
    const cursor = msgTextareaRef.current.selectionStart
    const before = form.body.slice(0, cursor).replace(/@[^@\s]*$/, `@${displayName} `)
    const after = form.body.slice(cursor)
    setForm(f => ({ ...f, body: before + after }))
    pendingMentionIdsRef.current.push(member.whatsapp_id)
    setMentionActive(false)
    setMentionSuggestions([])
    msgTextareaRef.current.focus()
  }

  const handleBodyKeyDown = (e) => {
    if (mentionActive && mentionSuggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionSuggestions.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionSuggestions[mentionIndex]); return }
      if (e.key === 'Escape')    { setMentionActive(false); return }
    }
  }

  const handleSave = async () => {
    if (!isValid) return
    const targetIdNum = parseInt(form.target_id, 10)
    if (Number.isNaN(targetIdNum)) {
      setFormError('Destinatario non valido. Riselezionalo dalla lista.')
      return
    }
    const dt = new Date(form.scheduled_at)
    if (Number.isNaN(dt.getTime())) {
      setFormError('Data/ora non valida.')
      return
    }
    setFormError('')
    const firstAtt = mediaAttachments[0]
    const payload = {
      account_id: accountId,
      target_type: form.target_type,
      target_id: targetIdNum,
      target_name: selectedTargetName,
      body: form.body,
      media_type: firstAtt?.type || 'text',
      media_path: firstAtt?.path || null,
      media_paths_json: mediaAttachments.length > 0 ? JSON.stringify(mediaAttachments) : null,
      scheduled_at: dt.toISOString(),
      next_send_at: dt.toISOString(),
      recurrence_type: form.recurrence_type,
      recurrence_rule: form.recurrence_type === 'custom' ? form.recurrence_rule : null,
      mentions_json: form.target_type === 'group' && pendingMentionIdsRef.current.length > 0
        ? JSON.stringify([...new Set(pendingMentionIdsRef.current)])
        : null
    }
    if (editing?.id) {
      await window.api.updateScheduled(editing.id, payload)
    } else {
      await window.api.createScheduled(payload)
    }
    onSaved?.()
    onClose()
  }

  const targetIcon = form.target_type === 'folder' ? <Folder size={16} strokeWidth={1.6} /> : (form.target_type === 'group' ? <Users size={16} strokeWidth={1.6} /> : <User size={16} strokeWidth={1.6} />)

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 560, maxHeight: '90vh', overflow: 'auto' }}>
        <div className="modal__header">
          <span className="modal__title">{editing ? <>Modifica <em>messaggio</em></> : <>Programma <em>messaggio</em></>}</span>
          <button className="btn--icon" onClick={onClose}><X size={20} strokeWidth={1.6} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Target type */}
          <div>
            <label style={lblStyle}>Destinatario</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { v: 'contact', label: 'Contatto', icon: <User size={14} strokeWidth={1.6} /> },
                { v: 'group',   label: 'Gruppo',   icon: <Users size={14} strokeWidth={1.6} /> },
                { v: 'folder',  label: 'Cartella', icon: <Folder size={14} strokeWidth={1.6} /> }
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
            <label style={lblStyle}>Messaggio{form.target_type === 'group' && groupMembers.length > 0 && <span style={{ marginLeft: 6, opacity: 0.6 }}>· digita @ per menzionare</span>}</label>
            <div style={{ position: 'relative' }}>
              {mentionActive && <MentionSuggestions suggestions={mentionSuggestions} activeIndex={mentionIndex} onSelect={insertMention} />}
              <textarea
                ref={msgTextareaRef}
                className="chat-input"
                rows={4}
                placeholder={mediaAttachments.length > 0 ? 'Didascalia (opzionale)...' : 'Scrivi il messaggio...'}
                value={form.body}
                onChange={handleBodyChange}
                onKeyDown={handleBodyKeyDown}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {form.body.length} caratteri
            </div>
          </div>

          {/* Media attachments */}
          <div>
            <label style={lblStyle}><Paperclip size={12} strokeWidth={1.6} /> Allegati{mediaAttachments.length > 0 && <span style={{ marginLeft: 6, opacity: 0.6 }}>· {mediaAttachments.length}</span>}</label>
            {mediaAttachments.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {mediaAttachments.map((att, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 999 }}>
                    {att.type === 'image'    && <Image    size={16} strokeWidth={1.6} color="var(--accent)" />}
                    {att.type === 'audio'    && <FileAudio size={16} strokeWidth={1.6} color="var(--accent)" />}
                    {att.type === 'video'    && <FileText  size={16} strokeWidth={1.6} color="var(--accent)" />}
                    {att.type === 'document' && <FileText  size={16} strokeWidth={1.6} color="var(--accent)" />}
                    <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</span>
                    <button type="button" className="btn--icon" onClick={() => handleRemoveMedia(i)} title="Rimuovi allegato"><X size={14} strokeWidth={1.6} /></button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn--ghost" style={{ flex: 1 }} onClick={handlePickFiles}>
                <Paperclip size={14} strokeWidth={1.6} /> Allega file
              </button>
              {!isRecording ? (
                <button type="button" className="btn btn--ghost" style={{ flex: 1 }} onClick={handleStartRecording}>
                  <Mic size={14} strokeWidth={1.6} /> Registra audio
                </button>
              ) : (
                <button type="button" className="btn btn--primary" style={{ flex: 1 }} onClick={handleStopRecording}>
                  <Square size={14} strokeWidth={1.6} fill="currentColor" />
                  {String(Math.floor(recordingSeconds / 60)).padStart(2,'0')}:{String(recordingSeconds % 60).padStart(2,'0')}
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lblStyle}><Clock size={12} strokeWidth={1.6} /> Data e ora</label>
              <input type="datetime-local" className="chat-input"
                value={form.scheduled_at}
                onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))} />
            </div>
            <div>
              <label style={lblStyle}><Repeat size={12} strokeWidth={1.6} /> Ricorrenza</label>
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
              <AlertTriangle size={14} strokeWidth={1.6} /> La data è nel passato: il messaggio non verrà inviato.
            </div>
          )}

          {/* Anteprima */}
          {(form.body || mediaAttachments.length > 0) && form.target_id && (
            <div style={previewBox}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Eye size={12} strokeWidth={1.6} /> ANTEPRIMA
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13 }}>
                {targetIcon} <strong>{selectedTargetName || '—'}</strong>
              </div>
              <div style={{
                background: 'var(--accent)', color: 'white', padding: '8px 12px',
                borderRadius: 12, borderTopRightRadius: 4, alignSelf: 'flex-end', maxWidth: '90%',
                fontSize: 13
              }}>
                {mediaAttachments.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: form.body ? 6 : 0, opacity: 0.9 }}>
                    {mediaAttachments.map((att, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Paperclip size={13} strokeWidth={1.6} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{att.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {form.body && <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{form.body}</div>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                Invio: {form.scheduled_at ? new Date(form.scheduled_at).toLocaleString('it-IT') : '—'}
                {form.recurrence_type !== 'once' && ` · ${RECURRENCE_OPTS.find(o => o.value === form.recurrence_type)?.label}`}
              </div>
            </div>
          )}

          {formError && (
            <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)', borderRadius: 8, color: 'var(--danger)', fontSize: 13 }}>
              {formError}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn--ghost" onClick={onClose}>Annulla</button>
            <button type="button" className="btn btn--primary" disabled={!isValid} onClick={handleSave}>
              <Send size={14} strokeWidth={1.6} /> {editing ? 'Salva modifiche' : 'Programma'}
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

import React, { useState, useEffect } from 'react'
import { Clock, Send, Trash2, Plus, Calendar, MessageSquare, Folder, Users, CheckCircle2, AlertCircle, X } from 'lucide-react'

export default function ScheduledList({ accountId }) {
  const [messages, setMessages] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [contacts, setContacts] = useState([])
  const [folders, setFolders] = useState([])
  const [newMessage, setNewMessage] = useState({
    target_type: 'contact',
    target_id: '',
    body: '',
    scheduled_at: '',
    recurrence_type: 'once'
  })

  useEffect(() => {
    if (accountId) {
      loadMessages()
      loadData()
    }
  }, [accountId])

  const loadMessages = async () => {
    const list = await window.api.getScheduled(accountId)
    setMessages(list)
  }

  const loadData = async () => {
    const c = await window.api.getContacts(accountId)
    const g = await window.api.getGroups(accountId)
    setContacts([...c, ...g])
    const f = await window.api.getFolders()
    setFolders(f)
  }

  const handleCreate = async () => {
    if (!newMessage.target_id || !newMessage.body || !newMessage.scheduled_at) return
    
    // Trova il nome del target
    let targetName = ''
    if (newMessage.target_type === 'contact' || newMessage.target_type === 'group') {
      const target = contacts.find(c => c.id === parseInt(newMessage.target_id))
      targetName = target?.name || target?.push_name || 'Contatto'
    } else {
      const target = folders.find(f => f.id === parseInt(newMessage.target_id))
      targetName = target?.name || 'Cartella'
    }

    try {
      await window.api.createScheduled({
        ...newMessage,
        account_id: accountId,
        target_name: targetName,
        scheduled_at: new Date(newMessage.scheduled_at).toISOString()
      })
      
      setShowCreate(false)
      setNewMessage({ target_type: 'contact', target_id: '', body: '', scheduled_at: '', recurrence_type: 'once' })
      loadMessages()
    } catch (err) {
      console.error('Errore creazione messaggio programmato:', err)
      alert('Errore: assicurati di aver selezionato un account attivo e compilato tutti i campi.')
    }
  }

  const handleDelete = async (id) => {
    await window.api.deleteScheduled(id)
    loadMessages()
  }

  const getStatusIcon = (msg) => {
    const now = new Date()
    const scheduled = new Date(msg.next_send_at || msg.scheduled_at)
    if (scheduled < now) return <CheckCircle2 size={14} color="var(--success)" />
    return <Clock size={14} color="var(--warning)" />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="main-header">
        <div className="main-header__info">
          <div className="main-header__name">🕒 Messaggi Programmati</div>
        </div>
        <button className="btn btn--primary" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> Programma Messaggio
        </button>
      </div>

      <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
        {messages.length === 0 ? (
          <div className="empty-state">
            <Clock size={48} color="var(--text-muted)" style={{ opacity: 0.3 }} />
            <p>Nessun messaggio programmato.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {messages.map(msg => (
              <div key={msg.id} style={{ 
                background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', padding: 16,
                border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {msg.target_type === 'folder' ? <Folder size={16} color="var(--accent)" /> : <Users size={16} color="var(--accent)" />}
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{msg.target_name}</span>
                  </div>
                  <button className="btn--icon" onClick={() => handleDelete(msg.id)}><Trash2 size={14} /></button>
                </div>
                
                <div style={{ fontSize: 14, color: 'var(--text-primary)', lineBreak: 'anywhere' }}>
                  {msg.body}
                </div>

                <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {getStatusIcon(msg)}
                    {new Date(msg.next_send_at || msg.scheduled_at).toLocaleString('it-IT')}
                  </div>
                  <div style={{ textTransform: 'capitalize' }}>
                    {msg.recurrence_type !== 'once' && `♻️ ${msg.recurrence_type}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 450 }}>
            <div className="modal__header">
              <span className="modal__title">Programma Messaggio</span>
              <button className="btn--icon" onClick={() => setShowCreate(false)}><X size={20} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Invia a</label>
                  <select className="chat-input" value={newMessage.target_type} 
                    onChange={e => setNewMessage({ ...newMessage, target_type: e.target.value, target_id: '' })}>
                    <option value="contact">Contatto / Gruppo</option>
                    <option value="folder">Cartella</option>
                  </select>
                </div>
                <div style={{ flex: 2 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Destinatario</label>
                  <select className="chat-input" value={newMessage.target_id} 
                    onChange={e => setNewMessage({ ...newMessage, target_id: e.target.value })}>
                    <option value="">Seleziona...</option>
                    {newMessage.target_type === 'contact' ? (
                      contacts.map(c => <option key={c.id} value={c.id}>{c.name || c.push_name || c.phone_number}</option>)
                    ) : (
                      folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)
                    )}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Messaggio</label>
                <textarea className="chat-input" rows={4} placeholder="Scrivi il messaggio..."
                  value={newMessage.body} onChange={e => setNewMessage({ ...newMessage, body: e.target.value })} />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Data e Ora</label>
                  <input type="datetime-local" className="chat-input" 
                    value={newMessage.scheduled_at} onChange={e => setNewMessage({ ...newMessage, scheduled_at: e.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>Ricorrenza</label>
                  <select className="chat-input" value={newMessage.recurrence_type} 
                    onChange={e => setNewMessage({ ...newMessage, recurrence_type: e.target.value })}>
                    <option value="once">Una volta</option>
                    <option value="daily">Ogni giorno</option>
                    <option value="weekly">Ogni settimana</option>
                    <option value="monthly">Ogni mese</option>
                  </select>
                </div>
              </div>

              <button className="btn btn--primary" style={{ marginTop: 8, height: 40 }} onClick={handleCreate}>
                <Send size={16} /> Programma Invio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

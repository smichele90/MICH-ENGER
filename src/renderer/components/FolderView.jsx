import React, { useEffect, useState } from 'react'
import { Folder, Users, User, Settings, Send, Trash2, MessageSquare } from 'lucide-react'
import FolderContactManager from './FolderContactManager'
import ScheduleMessageModal from './ScheduleMessageModal'

/**
 * Vista principale di una cartella: mostra i contatti membri,
 * permette di aprire il manager o programmare un messaggio bulk.
 */
export default function FolderView({ folder, accountId, onSelectContact }) {
  const [members, setMembers] = useState([])
  const [showManager, setShowManager] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)

  useEffect(() => { refresh() }, [folder?.id])

  const refresh = async () => {
    if (!folder?.id) return
    setMembers(await window.api.getFolderMembers(folder.id))
  }

  const handleRemove = async (contactId, e) => {
    e.stopPropagation()
    await window.api.removeFolderMember(folder.id, contactId)
    refresh()
  }

  if (!folder) return null

  return (
    <>
      <div className="main-header">
        <div className="main-header__info">
          <div className="main-header__avatar" style={{ background: (folder.color || '#6C3CE1') + '33', color: folder.color || 'var(--accent)' }}>
            <Folder size={18} />
          </div>
          <div>
            <div className="main-header__name">{folder.name}</div>
            <div className="main-header__status">{members.length} contatti</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--ghost" onClick={() => setShowSchedule(true)} disabled={members.length === 0}>
            <Send size={14} /> Messaggio bulk
          </button>
          <button className="btn btn--primary" onClick={() => setShowManager(true)}>
            <Settings size={14} /> Gestisci contatti
          </button>
        </div>
      </div>

      <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
        {members.length === 0 ? (
          <div className="empty-state">
            <Folder size={48} color="var(--text-muted)" style={{ opacity: 0.3 }} />
            <div className="empty-state__title">Cartella vuota</div>
            <div className="empty-state__text">
              Aggiungi contatti o gruppi alla cartella per gestirli insieme.
            </div>
            <button className="btn btn--primary" style={{ marginTop: 12 }} onClick={() => setShowManager(true)}>
              <Settings size={14} /> Aggiungi contatti
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {members.map(c => (
              <div key={c.id}
                onClick={() => onSelectContact?.(c)}
                style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)', padding: 12, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10, transition: 'var(--transition)'
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'var(--accent-light)', color: 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  overflow: 'hidden'
                }}>
                  {c.profile_pic_path
                    ? <img src={`file:///${c.profile_pic_path.replace(/\\/g, '/')}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : (c.is_group ? <Users size={16} /> : <User size={16} />)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name || c.push_name || c.phone_number}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {c.is_group ? 'Gruppo' : (c.phone_number || '—')}
                  </div>
                </div>
                <button className="btn--icon" title="Apri chat"
                  onClick={(e) => { e.stopPropagation(); onSelectContact?.(c) }}>
                  <MessageSquare size={14} />
                </button>
                <button className="btn--icon" title="Rimuovi dalla cartella" onClick={(e) => handleRemove(c.id, e)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showManager && (
        <FolderContactManager
          folder={folder}
          accountId={accountId}
          onClose={() => setShowManager(false)}
          onChanged={refresh}
        />
      )}

      {showSchedule && (
        <ScheduleMessageModal
          accountId={accountId}
          editing={{ target_type: 'folder', target_id: folder.id, target_name: folder.name }}
          onClose={() => setShowSchedule(false)}
          onSaved={() => setShowSchedule(false)}
        />
      )}
    </>
  )
}

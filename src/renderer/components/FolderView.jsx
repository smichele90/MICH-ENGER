import React, { useEffect, useState } from 'react'
import { Folder, Users, User, Settings, Send, Trash2, MessageSquare } from 'lucide-react'
import AvatarImage from './AvatarImage'
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

      <div className="folder-members-panel">
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
          <div className="folder-members">
            {members.map(c => (
              <div key={c.id} className="folder-member-row" onClick={() => onSelectContact?.(c)}>
                <AvatarImage
                  profilePicPath={c.profile_pic_path}
                  profilePicUrl={c.profile_pic_url}
                  isGroup={c.is_group}
                  className="folder-member-row__avatar"
                />
                <div className="folder-member-row__info">
                  <div className="folder-member-row__name">{c.name || c.push_name || c.phone_number}</div>
                  <div className="folder-member-row__meta">{c.is_group ? 'Gruppo' : (c.phone_number || 'Contatto')}</div>
                </div>
                <div className="folder-member-row__actions">
                  <button className="btn--icon" title="Apri chat" onClick={(e) => { e.stopPropagation(); onSelectContact?.(c) }}>
                    <MessageSquare size={14} />
                  </button>
                  <button className="btn--icon" title="Rimuovi dalla cartella" onClick={(e) => handleRemove(c.id, e)}>
                    <Trash2 size={14} />
                  </button>
                </div>
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

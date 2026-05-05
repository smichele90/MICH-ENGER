import React, { useState, useEffect } from 'react'
import { ChevronDown, Folder, FolderOpen, FolderPlus, Pencil, Trash2, MoreHorizontal, Users } from 'lucide-react'
import AvatarImage from './AvatarImage'

export default function FolderTree({ folders, activeFolder, activeContact, onSelect, onSelectContact, onFolderAdded, onFolderUpdated, onFolderRemoved, onRefresh, onManage, depth = 0 }) {
  return (
    <div className={depth > 0 ? 'folder-children' : ''}>
      {folders.map(folder => (
        <FolderNode
          key={folder.id}
          folder={folder}
          activeFolder={activeFolder}
          activeContact={activeContact}
          onSelect={onSelect}
          onSelectContact={onSelectContact}
          onFolderAdded={onFolderAdded}
          onFolderUpdated={onFolderUpdated}
          onFolderRemoved={onFolderRemoved}
          onRefresh={onRefresh}
          onManage={onManage}
          depth={depth}
        />
      ))}
    </div>
  )
}

function FolderNode({ folder, activeFolder, activeContact, onSelect, onSelectContact, onFolderAdded, onFolderUpdated, onFolderRemoved, onRefresh, onManage, depth }) {
  const [isOpen, setIsOpen] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(folder.name)
  const [showNewSub, setShowNewSub] = useState(false)
  const [newSubName, setNewSubName] = useState('')
  const [members, setMembers] = useState([])
  const [hasLoadedMembers, setHasLoadedMembers] = useState(false)

  const hasChildren = folder.children && folder.children.length > 0

  useEffect(() => {
    setRenameValue(folder.name)
  }, [folder.name])

  useEffect(() => {
    if (isOpen && !hasLoadedMembers) {
      fetchMembers()
    }
  }, [isOpen])

  const fetchMembers = async () => {
    if (!folder?.id) return
    const data = await window.api.getFolderMembers(folder.id)
    setMembers(data || [])
    setHasLoadedMembers(true)
  }

  const handleToggle = async (e) => {
    e.stopPropagation()
    const nextOpen = !isOpen
    setIsOpen(nextOpen)
    if (nextOpen && !hasLoadedMembers) {
      await fetchMembers()
    }
  }

  const handleSelectFolder = (e) => {
    e.stopPropagation()
    onSelect?.(folder)
    setIsOpen(prev => !prev)
  }

  const handleRename = async () => {
    if (renameValue.trim() && renameValue !== folder.name) {
      await window.api.updateFolder(folder.id, { name: renameValue.trim() })
      onFolderUpdated?.(folder.id, { name: renameValue.trim() })
    }
    setIsRenaming(false)
  }

  const handleDelete = async () => {
    await window.api.deleteFolder(folder.id)
    onFolderRemoved?.(folder.id)
    setShowMenu(false)
  }

  const handleCreateSub = async () => {
    if (!newSubName.trim()) return
    const result = await window.api.createFolder({ name: newSubName.trim(), parent_id: folder.id })
    if (result?.id) {
      onFolderAdded?.({ id: result.id, name: newSubName.trim(), parent_id: folder.id, color: '#6C3CE1', icon: 'folder', sort_order: 0 })
    }
    setNewSubName('')
    setShowNewSub(false)
    setIsOpen(true)
  }

  return (
    <>
      <div
        className={`sidebar-item ${activeFolder?.id === folder.id ? 'sidebar-item--active' : ''}`}
        onClick={handleSelectFolder}
        onContextMenu={(e) => { e.preventDefault(); setShowMenu(!showMenu) }}
        style={{ paddingLeft: 16 + depth * 8 }}
      >
        <span className={`sidebar-item__chevron ${isOpen ? 'sidebar-item__chevron--open' : ''}`} onClick={handleToggle}>
          <ChevronDown size={14} />
        </span>

        <div className="sidebar-item__icon" style={{ color: folder.color || 'var(--text-muted)' }}>
          {isOpen ? <FolderOpen size={16} /> : <Folder size={16} />}
        </div>

        {isRenaming ? (
          <input
            autoFocus
            className="sidebar__search-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setIsRenaming(false) }}
            onBlur={handleRename}
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: 12, padding: '3px 8px', height: 24 }}
          />
        ) : (
          <span className="sidebar-item__label">{folder.name}</span>
        )}

        <button
          className="sidebar-section__action"
          onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }}
          style={{ opacity: showMenu ? 1 : undefined }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>

      {showMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1999 }} onClick={() => setShowMenu(false)} />
          <div className="context-menu" style={{ position: 'absolute', left: 60 + depth * 8, zIndex: 2000 }}>
            <button className="context-menu__item" onClick={() => { setShowNewSub(true); setShowMenu(false); setIsOpen(true) }}>
              <FolderPlus size={14} /> Nuova sub-cartella
            </button>
            <button className="context-menu__item" onClick={() => { onManage?.(folder); setShowMenu(false) }}>
              <Users size={14} /> Gestisci contatti
            </button>
            <button className="context-menu__item" onClick={() => { setIsRenaming(true); setShowMenu(false) }}>
              <Pencil size={14} /> Rinomina
            </button>
            <div className="context-menu__divider" />
            <button className="context-menu__item context-menu__item--danger" onClick={handleDelete}>
              <Trash2 size={14} /> Elimina
            </button>
          </div>
        </>
      )}

      {isOpen && (
        <div className="folder-member-list">
          {members.length === 0 ? (
            <div className="folder-member-empty">Nessun contatto nella cartella.</div>
          ) : (
            members.map(member => (
              <div
                key={member.id}
                className={`folder-member-item ${activeContact?.id === member.id ? 'folder-member-item--active' : ''}`}
                onClick={() => onSelectContact?.(member)}
              >
                <AvatarImage
                  profilePicPath={member.profile_pic_path}
                  profilePicUrl={member.profile_pic_url}
                  isGroup={member.is_group}
                  className="folder-member-item__avatar"
                />
                <div className="folder-member-item__text">
                  <div className="folder-member-item__name">{member.name || member.push_name || member.phone_number}</div>
                  <div className="folder-member-item__subtext">{member.is_group ? 'Gruppo' : (member.phone_number || 'Contatto')}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {isOpen && hasChildren && (
        <FolderTree
          folders={folder.children}
          activeFolder={activeFolder}
          activeContact={activeContact}
          onSelect={onSelect}
          onSelectContact={onSelectContact}
          onFolderAdded={onFolderAdded}
          onFolderUpdated={onFolderUpdated}
          onFolderRemoved={onFolderRemoved}
          onRefresh={onRefresh}
          onManage={onManage}
          depth={depth + 1}
        />
      )}

      {showNewSub && (
        <div style={{ paddingLeft: 32 + depth * 8, paddingRight: 16, paddingTop: 2, paddingBottom: 2 }}>
          <input
            autoFocus
            className="sidebar__search-input"
            placeholder="Nome sub-cartella..."
            value={newSubName}
            onChange={(e) => setNewSubName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateSub(); if (e.key === 'Escape') setShowNewSub(false) }}
            onBlur={() => { if (!newSubName.trim()) setShowNewSub(false) }}
            style={{ fontSize: 12, padding: '4px 8px' }}
          />
        </div>
      )}
    </>
  )
}

import React, { useState } from 'react'
import { ChevronRight, Folder, FolderOpen, FolderPlus, Pencil, Trash2, MoreHorizontal } from 'lucide-react'

export default function FolderTree({ folders, activeFolder, onSelect, onRefresh, depth = 0 }) {
  return (
    <div className={depth > 0 ? 'folder-children' : ''}>
      {folders.map(folder => (
        <FolderNode
          key={folder.id}
          folder={folder}
          activeFolder={activeFolder}
          onSelect={onSelect}
          onRefresh={onRefresh}
          depth={depth}
        />
      ))}
    </div>
  )
}

function FolderNode({ folder, activeFolder, onSelect, onRefresh, depth }) {
  const [isOpen, setIsOpen] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(folder.name)
  const [showNewSub, setShowNewSub] = useState(false)
  const [newSubName, setNewSubName] = useState('')

  const hasChildren = folder.children && folder.children.length > 0

  const handleToggle = (e) => {
    e.stopPropagation()
    setIsOpen(!isOpen)
  }

  const handleRename = async () => {
    if (renameValue.trim() && renameValue !== folder.name) {
      await window.api.updateFolder(folder.id, { name: renameValue.trim() })
      onRefresh()
    }
    setIsRenaming(false)
  }

  const handleDelete = async () => {
    await window.api.deleteFolder(folder.id)
    onRefresh()
    setShowMenu(false)
  }

  const handleCreateSub = async () => {
    if (!newSubName.trim()) return
    await window.api.createFolder({ name: newSubName.trim(), parent_id: folder.id })
    onRefresh()
    setNewSubName('')
    setShowNewSub(false)
    setIsOpen(true)
  }

  return (
    <>
      <div
        className={`sidebar-item ${activeFolder?.id === folder.id ? 'sidebar-item--active' : ''}`}
        onClick={() => onSelect(folder)}
        onContextMenu={(e) => { e.preventDefault(); setShowMenu(!showMenu) }}
        style={{ paddingLeft: 16 + depth * 8 }}
      >
        {/* Chevron per espandere */}
        {hasChildren ? (
          <span className={`sidebar-item__chevron ${isOpen ? 'sidebar-item__chevron--open' : ''}`} onClick={handleToggle}>
            <ChevronRight size={14} />
          </span>
        ) : (
          <span style={{ width: 14 }} />
        )}

        {/* Icona cartella */}
        <div className="sidebar-item__icon" style={{ color: folder.color || 'var(--text-muted)' }}>
          {isOpen ? <FolderOpen size={16} /> : <Folder size={16} />}
        </div>

        {/* Nome o input rinomina */}
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

        {/* Menu azioni */}
        <button
          className="sidebar-section__action"
          onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }}
          style={{ opacity: showMenu ? 1 : undefined }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>

      {/* Context menu */}
      {showMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1999 }} onClick={() => setShowMenu(false)} />
          <div className="context-menu" style={{ position: 'absolute', left: 60 + depth * 8, zIndex: 2000 }}>
            <button className="context-menu__item" onClick={() => { setShowNewSub(true); setShowMenu(false); setIsOpen(true) }}>
              <FolderPlus size={14} /> Nuova sub-cartella
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

      {/* Sub-cartelle */}
      {isOpen && hasChildren && (
        <FolderTree folders={folder.children} activeFolder={activeFolder} onSelect={onSelect} onRefresh={onRefresh} depth={depth + 1} />
      )}

      {/* Input nuova sub-cartella */}
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

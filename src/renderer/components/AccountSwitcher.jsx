import React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import ThemeToggle from './ThemeToggle'

export default function AccountSwitcher({ accounts, activeAccount, onSelect, onAdd, onDelete, theme, onToggleTheme }) {
  const getInitials = (account) => {
    if (account.name) return account.name.charAt(0).toUpperCase()
    if (account.phone_number) return account.phone_number.slice(-2)
    return '?'
  }

  const getColor = (index) => {
    const colors = ['#6C3CE1', '#3B82F6', '#10b981', '#f59e0b', '#ef4444', '#ec4899']
    return colors[index % colors.length]
  }

  return (
    <div className="account-bar">
      {accounts.map((account, i) => (
        <div
          key={account.id}
          className={`account-avatar ${activeAccount?.id === account.id ? 'account-avatar--active' : ''} group`}
          style={{ background: getColor(i), position: 'relative' }}
          onClick={() => onSelect(account)}
          title={account.name || account.phone_number || `Account ${i + 1}`}
        >
          {getInitials(account)}
          <span className={`account-avatar__status ${account.is_active ? 'account-avatar__status--online' : 'account-avatar__status--offline'}`} />
          
          <button 
            className="account-avatar__delete"
            onClick={(e) => { e.stopPropagation(); onDelete(account.id) }}
            title="Elimina account"
          >
            <Trash2 size={10} />
          </button>
        </div>
      ))}

      {accounts.length > 0 && <div className="account-bar__divider" />}

      <button className="account-bar__add" onClick={onAdd} title="Aggiungi account">
        <Plus size={18} />
      </button>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Theme toggle in basso */}
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
    </div>
  )
}

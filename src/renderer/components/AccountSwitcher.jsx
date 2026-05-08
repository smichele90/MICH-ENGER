import React, { useState } from 'react'
import { Plus, Trash2, Volume2, VolumeX } from 'lucide-react'
import ThemeToggle from './ThemeToggle'
import ColorPanel from './ColorPanel'

function AccountAvatar({ account, initials, color, isActive, onClick, onDelete, statusClass }) {
  const [imgError, setImgError] = useState(false)
  const showImg = account.profile_pic_url && !imgError

  return (
    <div
      className={`account-avatar ${isActive ? 'account-avatar--active' : ''} group`}
      style={{ background: showImg ? 'transparent' : color, position: 'relative', overflow: 'hidden', padding: 0 }}
      onClick={onClick}
      title={account.name || account.phone_number || 'Account'}
    >
      {showImg ? (
        <img
          src={account.profile_pic_url}
          alt=""
          onError={() => setImgError(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: 'inherit' }}
        />
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
          {initials}
        </span>
      )}
      <span className={`account-avatar__status ${statusClass}`} />
      <button
        className="account-avatar__delete"
        onClick={(e) => { e.stopPropagation(); onDelete(account.id) }}
        title="Elimina account"
      >
        <Trash2 size={10} strokeWidth={1.6} />
      </button>
    </div>
  )
}

const STATUS_CFG = {
  ready:        { color: '#6b8a5e', label: 'Connesso',                              cursor: 'default' },
  loading:      { color: '#b8763a', label: 'Connessione in corso…',                cursor: 'wait'    },
  disconnected: { color: '#9a4f3f', label: 'Disconnesso — clicca per riconnettere', cursor: 'pointer' },
  error:        { color: '#9a4f3f', label: 'Errore — clicca per riconnettere',      cursor: 'pointer' },
}

function WaStatusDot({ status, onClick }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.disconnected
  return (
    <button
      onClick={onClick}
      title={cfg.label}
      style={{ background: 'none', border: 'none', padding: '8px', cursor: cfg.cursor,
               display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <span
        className={status === 'loading' ? 'wa-status--loading' : ''}
        style={{ display: 'block', width: 12, height: 12, borderRadius: '50%', background: cfg.color }}
      />
    </button>
  )
}

export default function AccountSwitcher({ accounts, activeAccount, onSelect, onAdd, onDelete, theme, onToggleTheme, soundEnabled, onToggleSound, connectionStatuses, onReconnect }) {
  const getInitials = (account) => {
    if (account.name) return account.name.charAt(0).toUpperCase()
    if (account.phone_number) return account.phone_number.slice(-2)
    return '?'
  }

  const getColor = (index) => {
    const colors = ['#8b6f47', '#6b8a5e', '#b8763a', '#9a4f3f', '#4a7a8a', '#7a6b8a']
    return colors[index % colors.length]
  }

  return (
    <div className="account-bar">
      {accounts.map((account, i) => {
        const status = connectionStatuses?.[account.id] ?? (account.is_active ? 'ready' : 'disconnected')
        const statusClass =
          status === 'ready'   ? 'account-avatar__status--online'  :
          status === 'loading' ? 'account-avatar__status--loading' :
                                 'account-avatar__status--offline'
        return (
          <AccountAvatar
            key={account.id}
            account={account}
            initials={getInitials(account)}
            color={getColor(i)}
            isActive={activeAccount?.id === account.id}
            onClick={() => onSelect(account)}
            onDelete={onDelete}
            statusClass={statusClass}
          />
        )
      })}

      {accounts.length === 0 && (
        <button className="account-bar__add" onClick={onAdd} title="Collega account WhatsApp">
          <Plus size={18} strokeWidth={1.6} />
        </button>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Semaforo connessione account attivo */}
      {activeAccount && (
        <WaStatusDot
          status={connectionStatuses?.[activeAccount.id] ?? 'disconnected'}
          onClick={() => {
            const s = connectionStatuses?.[activeAccount.id]
            if (s !== 'ready' && s !== 'loading') onReconnect?.(activeAccount.id)
          }}
        />
      )}

      {/* Toggle suono notifiche */}
      <button
        className="theme-toggle"
        onClick={onToggleSound}
        title={soundEnabled ? 'Disattiva suono notifiche' : 'Attiva suono notifiche'}
        style={!soundEnabled ? { color: 'var(--text-muted)', opacity: 0.45 } : undefined}
      >
        {soundEnabled ? <Volume2 size={18} strokeWidth={1.6} /> : <VolumeX size={18} strokeWidth={1.6} />}
      </button>

      {/* Pannello colori */}
      <ColorPanel theme={theme} />

      {/* Theme toggle in basso */}
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
    </div>
  )
}

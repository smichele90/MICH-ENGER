import React from 'react'
import AvatarImage from './AvatarImage'

const COLORS = [
  '#8b6f47', '#6b8a5e', '#b8763a', '#9a4f3f',
  '#4a7a8a', '#7a6b8a', '#a86f6f', '#5e8a7d'
]

function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function initialOf(name) {
  if (!name) return '?'
  const trimmed = String(name).trim()
  if (!trimmed) return '?'
  const ch = trimmed.charAt(0).toUpperCase()
  return /[A-Z0-9]/i.test(ch) ? ch : '?'
}

export default function SenderAvatar({ waId, name, info, size = 24 }) {
  const profilePath = info?.profile_pic_path
  const profileUrl = info?.profile_pic_url
  const displayName = info?.name || name || ''
  const seed = waId || displayName || ''
  const color = COLORS[hashStr(seed) % COLORS.length]

  const baseStyle = {
    width: size, height: size,
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }

  if (profilePath || profileUrl) {
    return (
      <AvatarImage
        profilePicPath={profilePath}
        profilePicUrl={profileUrl}
        isGroup={false}
        style={{ ...baseStyle, background: color }}
      />
    )
  }

  return (
    <div style={{ ...baseStyle, background: color, color: '#fff', fontSize: Math.max(10, Math.round(size * 0.45)), fontWeight: 600 }}>
      {initialOf(displayName)}
    </div>
  )
}

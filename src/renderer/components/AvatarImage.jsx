import React, { useEffect, useState } from 'react'
import { Users, User } from 'lucide-react'

export default function AvatarImage({ profilePicPath, profilePicUrl, isGroup, className, style }) {
  const [resolvedSrc, setResolvedSrc] = useState(null)

  useEffect(() => {
    let active = true

    const resolve = async () => {
      const localPath = profilePicPath?.trim()
      if (localPath) {
        try {
          const exists = await window.api.fileExists(localPath)
          if (!active) return
          if (exists) {
            setResolvedSrc(`file:///${localPath.replace(/\\/g, '/')}`)
            return
          }
        } catch { /* fallback all'URL */ }
      }
      if (!active) return
      setResolvedSrc(profilePicUrl || null)
    }

    resolve()
    return () => { active = false }
  }, [profilePicPath, profilePicUrl])

  const handleError = (e) => {
    if (resolvedSrc && profilePicUrl && e.target.src !== profilePicUrl) {
      e.target.src = profilePicUrl
      return
    }
    e.target.style.display = 'none'
  }

  return (
    <div className={className} style={style}>
      {resolvedSrc ? (
        <img src={resolvedSrc} alt="" onError={handleError} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div className="avatar-fallback" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          {isGroup ? <Users size={16} /> : <User size={16} />}
        </div>
      )}
    </div>
  )
}

import React, { useState, useEffect, useRef } from 'react'
import { Palette, RotateCcw } from 'lucide-react'

const DEFAULTS = {
  accent: '#6C3CE1',
  messageBubble: '#6C3CE1',
  sidebarBg: '#12122a',
}

const COLOR_ROWS = [
  { key: 'accent', label: 'Colore accento' },
  { key: 'messageBubble', label: 'Bolle messaggi inviati' },
  { key: 'sidebarBg', label: 'Sfondo sidebar' },
]

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function applyColors(colors) {
  document.documentElement.style.setProperty('--accent', colors.accent)
  document.documentElement.style.setProperty('--accent-hover', colors.accent)
  document.documentElement.style.setProperty('--accent-light', hexToRgba(colors.accent, 0.15))
  document.documentElement.style.setProperty('--bg-active', hexToRgba(colors.accent, 0.2))
  document.documentElement.style.setProperty('--bg-message-me', colors.messageBubble)
  document.documentElement.style.setProperty('--bg-sidebar', colors.sidebarBg)
}

export default function ColorPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [colors, setColors] = useState(DEFAULTS)
  const panelRef = useRef(null)
  const btnRef = useRef(null)

  useEffect(() => {
    async function loadColors() {
      const saved = await window.api.getSetting('customColors')
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          const merged = { ...DEFAULTS, ...parsed }
          setColors(merged)
        } catch {}
      }
    }
    loadColors()
  }, [])

  useEffect(() => {
    if (!isOpen) return
    function handleClick(e) {
      if (
        panelRef.current && !panelRef.current.contains(e.target) &&
        btnRef.current && !btnRef.current.contains(e.target)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  const handleChange = async (key, value) => {
    const next = { ...colors, [key]: value }
    setColors(next)
    applyColors(next)
    await window.api.setSetting('customColors', JSON.stringify(next))
  }

  const handleReset = async () => {
    setColors(DEFAULTS)
    applyColors(DEFAULTS)
    await window.api.setSetting('customColors', '')
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        className="theme-toggle"
        onClick={() => setIsOpen(prev => !prev)}
        title="Personalizza colori"
        style={isOpen ? { color: 'var(--accent)', background: 'var(--accent-light)' } : undefined}
      >
        <Palette size={18} />
      </button>

      {isOpen && (
        <div ref={panelRef} className="color-panel">
          <div className="color-panel__title">Colori</div>
          {COLOR_ROWS.map(({ key, label }) => (
            <div key={key} className="color-panel__row">
              <label className="color-panel__label" htmlFor={`cp-${key}`}>{label}</label>
              <input
                id={`cp-${key}`}
                type="color"
                className="color-panel__input"
                value={colors[key]}
                onChange={(e) => handleChange(key, e.target.value)}
              />
            </div>
          ))}
          <button className="color-panel__reset" onClick={handleReset}>
            <RotateCcw size={12} /> Ripristina predefiniti
          </button>
        </div>
      )}
    </div>
  )
}

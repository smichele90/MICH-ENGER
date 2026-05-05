import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Palette, RotateCcw, Moon, Sun, X } from 'lucide-react'

const DEFAULTS = {
  dark: {
    sidebarBg: '#12122a',
    chatBg: '#1a1a2e',
    messageSent: '#6C3CE1',
    messageReceived: '#222244',
  },
  light: {
    sidebarBg: '#ffffff',
    chatBg: '#f5f5fa',
    messageSent: '#6C3CE1',
    messageReceived: '#e8e8f0',
  },
}

const COLOR_ROWS = [
  { key: 'sidebarBg', label: 'Sfondo sidebar' },
  { key: 'chatBg', label: 'Sfondo chat' },
  { key: 'messageSent', label: 'Nuvola messaggi inviati' },
  { key: 'messageReceived', label: 'Nuvola messaggi ricevuti' },
]

function applyThemeColors(theme, colors) {
  const c = colors[theme]
  document.documentElement.style.setProperty('--bg-sidebar', c.sidebarBg)
  document.documentElement.style.setProperty('--bg-primary', c.chatBg)
  document.documentElement.style.setProperty('--bg-message-me', c.messageSent)
  document.documentElement.style.setProperty('--bg-message-other', c.messageReceived)
}

export default function ColorPanel({ theme }) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState(theme)
  const [colors, setColors] = useState(DEFAULTS)
  const colorsRef = useRef(DEFAULTS)
  const btnRef = useRef(null)
  const panelRef = useRef(null)

  // Keep ref in sync with state for use in callbacks and effects
  useEffect(() => { colorsRef.current = colors }, [colors])

  // Load saved colors on mount and apply for active theme
  useEffect(() => {
    async function loadColors() {
      const saved = await window.api.getSetting('customColors')
      if (!saved) return
      try {
        const parsed = JSON.parse(saved)
        if (!parsed.dark && !parsed.light) return // ignore old format
        const merged = {
          dark: { ...DEFAULTS.dark, ...(parsed.dark || {}) },
          light: { ...DEFAULTS.light, ...(parsed.light || {}) },
        }
        setColors(merged)
        colorsRef.current = merged
        applyThemeColors(theme, merged)
      } catch {}
    }
    loadColors()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-apply and sync tab when the active theme changes (user toggled light/dark)
  useEffect(() => {
    applyThemeColors(theme, colorsRef.current)
    setActiveTab(theme)
  }, [theme])

  // Close panel on outside click
  useEffect(() => {
    if (!isOpen) return
    function handleMouseDown(e) {
      if (!panelRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [isOpen])

  const handleChange = useCallback(async (key, value) => {
    const next = {
      ...colorsRef.current,
      [activeTab]: { ...colorsRef.current[activeTab], [key]: value },
    }
    setColors(next)
    colorsRef.current = next
    if (activeTab === theme) applyThemeColors(theme, next)
    await window.api.setSetting('customColors', JSON.stringify(next))
  }, [activeTab, theme])

  const handleReset = useCallback(async () => {
    const next = {
      ...colorsRef.current,
      [activeTab]: { ...DEFAULTS[activeTab] },
    }
    setColors(next)
    colorsRef.current = next
    if (activeTab === theme) applyThemeColors(theme, next)
    await window.api.setSetting('customColors', JSON.stringify(next))
  }, [activeTab, theme])

  const currentColors = colors[activeTab]

  return (
    <>
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
          <div className="color-panel__header">
            <span className="color-panel__title">Personalizzazione colori</span>
            <button className="color-panel__close" onClick={() => setIsOpen(false)} title="Chiudi">
              <X size={14} />
            </button>
          </div>

          <div className="color-panel__tabs">
            <button
              className={`color-panel__tab ${activeTab === 'dark' ? 'color-panel__tab--active' : ''}`}
              onClick={() => setActiveTab('dark')}
            >
              <Moon size={12} />
              Scuro
              {theme === 'dark' && <span className="color-panel__tab-dot" />}
            </button>
            <button
              className={`color-panel__tab ${activeTab === 'light' ? 'color-panel__tab--active' : ''}`}
              onClick={() => setActiveTab('light')}
            >
              <Sun size={12} />
              Chiaro
              {theme === 'light' && <span className="color-panel__tab-dot" />}
            </button>
          </div>

          {activeTab !== theme && (
            <div className="color-panel__notice">
              Stai modificando il tema {activeTab === 'dark' ? 'scuro' : 'chiaro'} (non attivo).
              Le modifiche si applicano al cambio tema.
            </div>
          )}

          <div className="color-panel__colors">
            {COLOR_ROWS.map(({ key, label }) => (
              <label key={key} className="color-panel__row" htmlFor={`cp-${activeTab}-${key}`}>
                <span className="color-panel__swatch" style={{ background: currentColors[key] }} />
                <span className="color-panel__label">{label}</span>
                <input
                  id={`cp-${activeTab}-${key}`}
                  type="color"
                  className="color-panel__input"
                  value={currentColors[key]}
                  onChange={(e) => handleChange(key, e.target.value)}
                />
              </label>
            ))}
          </div>

          <button className="color-panel__reset" onClick={handleReset}>
            <RotateCcw size={12} />
            Ripristina tema {activeTab === 'dark' ? 'scuro' : 'chiaro'}
          </button>
        </div>
      )}
    </>
  )
}

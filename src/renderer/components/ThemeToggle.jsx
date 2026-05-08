import React from 'react'
import { Sun, Moon } from 'lucide-react'

/**
 * Bottone di toggle tema.
 * Lo stato `theme` ('dark' | 'light') è gestito dal parent (App.jsx),
 * persistito su settings via window.api.setSetting('theme', ...).
 */
export default function ThemeToggle({ theme, onToggle, className = 'theme-toggle' }) {
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      className={className}
      onClick={onToggle}
      title={isDark ? 'Passa al tema chiaro' : 'Passa al tema scuro'}
      aria-label="Toggle tema"
    >
      {isDark ? <Sun size={18} strokeWidth={1.6} /> : <Moon size={18} strokeWidth={1.6} />}
    </button>
  )
}

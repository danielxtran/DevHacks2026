import { useSyncExternalStore } from 'react'

// Theme lives on <html data-theme>. index.html sets it before first paint.
const listeners = new Set()

const read = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem('theme', theme)
  } catch {
    // storage unavailable; the choice just won't persist
  }
  listeners.forEach((l) => l())
}

export function useTheme() {
  const theme = useSyncExternalStore((cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }, read)
  return [theme, setTheme]
}

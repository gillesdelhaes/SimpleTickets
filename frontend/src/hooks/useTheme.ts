import { useCallback, useState } from 'react'

export type Theme = 'dark' | 'light'

// Theme is carried by <html data-theme> (set pre-paint in index.html) and
// persisted in localStorage. Glasshouse tokens react to the attribute.
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(
    () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'),
  )

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.dataset.theme = next
    localStorage.setItem('st-theme', next)
    setThemeState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light')
  }, [setTheme])

  return { theme, setTheme, toggleTheme }
}

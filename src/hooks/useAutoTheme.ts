import { useEffect, useState } from 'react';

export type ThemeMode = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'equipochat-theme';

export function useAutoTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'auto') {
        return saved;
      }
    } catch {
      // ignore storage errors
    }
    return 'auto';
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const shouldBeDark = mode === 'dark' || (mode === 'auto' && mediaQuery.matches);
      document.documentElement.classList.toggle('dark', shouldBeDark);
    };

    applyTheme();
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore storage errors
    }

    if (mode === 'auto') {
      mediaQuery.addEventListener('change', applyTheme);
      return () => mediaQuery.removeEventListener('change', applyTheme);
    }
  }, [mode]);

  const cycleMode = () => {
    setMode((prev) => (prev === 'auto' ? 'light' : prev === 'light' ? 'dark' : 'auto'));
  };

  return { mode, setMode, cycleMode };
}

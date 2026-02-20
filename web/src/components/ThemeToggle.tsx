'use client';

import { useEffect, useState, type CSSProperties } from 'react';

type Theme = 'light' | 'dark';

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const stored = window.localStorage.getItem('shipscoper-theme');
    if (stored === 'dark' || stored === 'light') {
      setTheme(stored);
      applyTheme(stored);
      return;
    }

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initial: Theme = prefersDark ? 'dark' : 'light';
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    window.localStorage.setItem('shipscoper-theme', next);
    applyTheme(next);
  };

  return (
    <button type="button" onClick={toggle} style={styles.btn}>
      {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
    </button>
  );
}

const styles: Record<string, CSSProperties> = {
  btn: {
    border: '1px solid var(--border-strong)',
    backgroundColor: 'var(--surface-muted)',
    color: 'var(--text-primary)',
    borderRadius: '8px',
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600,
  },
};

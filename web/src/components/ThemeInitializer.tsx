'use client';

import { useEffect } from 'react';

export default function ThemeInitializer() {
  useEffect(() => {
    const stored = window.localStorage.getItem('shipscoper-theme');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
      return;
    }

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }, []);

  return null;
}

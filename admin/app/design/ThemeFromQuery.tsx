'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';

/** Preview-only: /design/list?theme=light switches theme so headless screenshots can capture both. */
export function ThemeFromQuery() {
  const { setTheme } = useTheme();
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('theme');
    if (q === 'light' || q === 'dark') setTheme(q);
  }, [setTheme]);
  return null;
}

'use client';

import {useState} from 'react';
import {Moon,Sun} from 'lucide-react';

export function ThemeToggle() {
  const [dark,setDark] = useState(() => document.documentElement.dataset.theme === 'dark');

  function toggle() {
    const next = dark ? 'light' : 'dark';
    const root = document.documentElement;
    root.dataset.theme = next;
    setDark(next === 'dark');
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content',getComputedStyle(root).getPropertyValue('--bg').trim());
    try { localStorage.setItem('dz-lab-theme',next); } catch { /* Theme still applies for this page. */ }
  }

  return (
    <button type="button" className="theme-toggle icon-button" aria-label="Тёмная тема"
      aria-pressed={dark} title={dark ? 'Включить светлую тему' : 'Включить тёмную тему'} onClick={toggle}>
      {dark ? <Sun size={19} aria-hidden="true"/> : <Moon size={19} aria-hidden="true"/>}
    </button>
  );
}

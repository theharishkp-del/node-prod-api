/**
 * @file Light/dark theme state, persisted in localStorage and applied to <html>.
 */
import { Injectable, effect, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';
const STORAGE_KEY = 'iq-admin.theme';

/** Light (default) / dark mode: toggles the `dark` class (color-scheme) on <html>. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light');

  constructor() {
    effect(() => {
      const mode = this.mode();
      document.documentElement.classList.toggle('dark', mode === 'dark');
      localStorage.setItem(STORAGE_KEY, mode);
    });
  }

  toggle(): void {
    this.mode.update((m) => (m === 'dark' ? 'light' : 'dark'));
  }
}

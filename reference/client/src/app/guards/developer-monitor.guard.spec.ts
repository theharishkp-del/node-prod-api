import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasDeveloperMonitorKey } from './developer-monitor.guard';

describe('developerMonitorGuard', () => {
  beforeEach(() => {
    const store = new Map<string, string>();

    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    });
  });

  it('returns false when the key is missing', () => {
    expect(hasDeveloperMonitorKey()).toBe(false);
  });

  it('returns true when the developer key has already been entered', () => {
    sessionStorage.setItem('developerMonitorKey', 'test-key');

    expect(hasDeveloperMonitorKey()).toBe(true);
  });
});

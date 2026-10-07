import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

const STORAGE_KEY = 'developerMonitorKey';

export function hasDeveloperMonitorKey(): boolean {
  if (typeof sessionStorage === 'undefined') {
    return false;
  }

  return Boolean(sessionStorage.getItem(STORAGE_KEY)?.trim());
}

export const developerMonitorGuard: CanActivateFn = () => {
  const router = inject(Router);

  if (hasDeveloperMonitorKey()) {
    return true;
  }

  return router.createUrlTree(['/developer-monitor']);
};

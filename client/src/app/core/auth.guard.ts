/**
 * @file Route guard that requires a working admin key (or an open-mode server).
 */
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AdminKeyService } from './admin-key.service';

/** Allows the admin shell when the stored key (or open mode) is accepted by the API. */
export const authGuard: CanActivateFn = (_route, state) => {
  const keys = inject(AdminKeyService);
  const router = inject(Router);
  return keys
    .ensureAccess()
    .pipe(map((ok) => (ok ? true : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } }))));
};

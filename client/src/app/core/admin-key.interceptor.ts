/**
 * @file HTTP interceptor that sends the stored admin key and handles 401 responses.
 */
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { API_BASE } from './api-base';
import { AdminKeyService } from './admin-key.service';

/**
 * Adds `x-admin-key` to admin API calls and sends the user back to the sign-in page when
 * the API answers 401 (wrong/rotated key). The sign-in check call sets its own header.
 */
export const adminKeyInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(API_BASE)) return next(req);
  const keys = inject(AdminKeyService);
  const router = inject(Router);
  const isAuthCheck = req.url.endsWith('/auth/check');

  const key = keys.key();
  const outgoing = key && !req.headers.has('x-admin-key') ? req.clone({ setHeaders: { 'x-admin-key': key } }) : req;

  return next(outgoing).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && !isAuthCheck) {
        keys.clear();
        router.navigate(['/login'], { queryParams: { returnUrl: router.url, reason: 'expired' } });
      }
      return throwError(() => err);
    }),
  );
};

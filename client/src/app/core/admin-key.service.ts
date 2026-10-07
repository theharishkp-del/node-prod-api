/**
 * @file Admin API key storage (localStorage) and verification against /auth/check.
 */
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { AdminApi } from './admin-api.service';

const STORAGE_KEY = 'iq-admin.key';

/**
 * Holds the admin API key (entered on the sign-in page, kept in localStorage of this
 * browser only - never baked into the build) and whether the server requires one.
 */
@Injectable({ providedIn: 'root' })
export class AdminKeyService {
  private readonly api = inject(AdminApi);

  readonly key = signal<string | null>(localStorage.getItem(STORAGE_KEY));
  /** null = not verified yet in this page load. */
  readonly verified = signal<boolean | null>(null);
  readonly authRequired = signal<boolean>(true);

  /** Store a verified key. */
  setKey(key: string): void {
    localStorage.setItem(STORAGE_KEY, key);
    this.key.set(key);
    this.verified.set(true);
  }

  /** Forget the key (sign out / 401). */
  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.key.set(null);
    this.verified.set(false);
  }

  /** Ask the server whether `key` (or no key) is accepted. */
  verify(key: string | null = this.key()): Observable<boolean> {
    return this.api.checkAuth(key).pipe(
      tap((r) => this.authRequired.set(r.authRequired)),
      map(() => true),
      catchError(() => of(false)),
    );
  }

  /** Guard helper: true when the stored key (or open mode) works. Cached per page load. */
  ensureAccess(): Observable<boolean> {
    if (this.verified() === true) return of(true);
    return this.verify().pipe(tap((ok) => this.verified.set(ok)));
  }
}

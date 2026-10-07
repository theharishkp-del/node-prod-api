/**
 * @file Helpers that turn admin API error responses into messages and form-control errors.
 */
import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, FormGroup } from '@angular/forms';
import { ApiErrorBody } from './models';

/** Human readable message of an API/HTTP error. */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Cannot reach the server. Check your connection.';
    const body = err.error as ApiErrorBody | null;
    const msg = body?.error?.message;
    const details = body?.error?.details;
    if (msg && details?.length && body?.error?.code === 'VALIDATION_ERROR') {
      return `${msg}: ${details.map((d) => `${d.path || 'body'} ${d.message}`).join('; ')}`;
    }
    return msg || `${fallback} (HTTP ${err.status})`;
  }
  return err instanceof Error ? err.message : fallback;
}

/**
 * Copy server-side validation details ({ path: 'address.city', message }) onto the
 * matching form controls as a `server` error. Returns true when at least one matched.
 */
export function applyServerErrors(form: FormGroup, err: unknown): boolean {
  if (!(err instanceof HttpErrorResponse)) return false;
  const details = (err.error as ApiErrorBody | null)?.error?.details ?? [];
  let matched = false;
  for (const d of details) {
    const control: AbstractControl | null = d.path ? form.get(d.path) : null;
    if (control) {
      control.setErrors({ ...(control.errors ?? {}), server: d.message });
      control.markAsTouched();
      matched = true;
    }
  }
  return matched;
}

/**
 * @file Toast notifications (Material snack bar) for success and error messages.
 */
import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { errorMessage } from './errors';

/** Toast notifications (Material snack bar). */
@Injectable({ providedIn: 'root' })
export class NotifyService {
  private readonly snack = inject(MatSnackBar);

  success(message: string): void {
    this.snack.open(message, 'OK', { duration: 3500, panelClass: 'toast-success' });
  }

  error(errOrMessage: unknown, fallback = 'Something went wrong'): void {
    const message = typeof errOrMessage === 'string' ? errOrMessage : errorMessage(errOrMessage, fallback);
    this.snack.open(message, 'Dismiss', { duration: 6000, panelClass: 'toast-error' });
  }
}

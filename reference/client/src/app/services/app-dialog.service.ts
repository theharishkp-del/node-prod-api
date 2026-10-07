import { Injectable, signal } from '@angular/core';

export interface AppDialogState {
  title: string;
  message: string;
  buttonLabel?: string;
  cancelLabel?: string;
  variant?: 'info' | 'confirm';
  onConfirm?: (() => void) | null;
  onCancel?: (() => void) | null;
}

@Injectable({ providedIn: 'root' })
export class AppDialogService {
  private readonly dialogStateSignal = signal<AppDialogState | null>(null);

  readonly dialogState = this.dialogStateSignal.asReadonly();

  open(state: AppDialogState): void {
    this.dialogStateSignal.set(state);
  }

  confirm(state: AppDialogState): void {
    this.dialogStateSignal.set({
      variant: 'confirm',
      buttonLabel: 'Confirm',
      cancelLabel: 'Cancel',
      ...state,
    });
  }

  runConfirm(): void {
    const currentState = this.dialogStateSignal();
    this.dialogStateSignal.set(null);
    currentState?.onConfirm?.();
  }

  runCancel(): void {
    const currentState = this.dialogStateSignal();
    this.dialogStateSignal.set(null);
    currentState?.onCancel?.();
  }

  close(): void {
    this.dialogStateSignal.set(null);
  }
}

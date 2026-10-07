/**
 * @file Reusable confirmation dialog and a service to open it.
 */
import { Component, Injectable, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Observable, map } from 'rxjs';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Red confirm button + warning icon. */
  danger?: boolean;
  icon?: string;
}

/** Generic confirmation dialog. */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="confirm">
      <div class="icon" [class.danger]="data.danger">
        <mat-icon>{{ data.icon || (data.danger ? 'warning_amber' : 'help_outline') }}</mat-icon>
      </div>
      <h2 mat-dialog-title>{{ data.title }}</h2>
      <mat-dialog-content>
        <p>{{ data.message }}</p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton [mat-dialog-close]="false">{{ data.cancelText || 'Cancel' }}</button>
        <button matButton="filled" [class.danger-btn]="data.danger" [mat-dialog-close]="true" cdkFocusInitial>
          {{ data.confirmText || 'Confirm' }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: `
    .confirm {
      padding-top: 20px;
      max-width: 440px;
    }
    .icon {
      margin: 0 24px;
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: grid;
      place-items: center;
      color: var(--app-primary-strong);
      background: var(--app-primary-soft);
      &.danger {
        color: var(--app-red);
        background: var(--app-red-soft);
      }
    }
    h2 {
      padding-top: 14px !important;
    }
    p {
      margin: 0;
      color: var(--app-muted);
      line-height: 1.55;
    }
    .danger-btn {
      --mat-button-filled-container-color: #e11d48;
      --mat-button-filled-label-text-color: #fff;
    }
  `,
})
export class ConfirmDialog {
  readonly data = inject<ConfirmOptions>(MAT_DIALOG_DATA);
}

/** Opens ConfirmDialog; emits true only when confirmed. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly dialog = inject(MatDialog);

  confirm(options: ConfirmOptions): Observable<boolean> {
    return this.dialog
      .open(ConfirmDialog, { data: options, autoFocus: 'dialog', width: '440px', maxWidth: '92vw' })
      .afterClosed()
      .pipe(map((r) => r === true));
  }
}

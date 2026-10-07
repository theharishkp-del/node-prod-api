import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { AppDialogService } from '../../services/app-dialog.service';

@Component({
  selector: 'app-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app-dialog.html',
  styleUrl: './app-dialog.css',
})
export class AppDialog {
  protected readonly appDialogService = inject(AppDialogService);

  protected closeDialog(): void {
    this.appDialogService.close();
  }

  protected confirmDialog(): void {
    this.appDialogService.runConfirm();
  }

  protected cancelDialog(): void {
    this.appDialogService.runCancel();
  }
}

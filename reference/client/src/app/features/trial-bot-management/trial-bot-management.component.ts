import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { TrialBotManagementService, TrialBot } from './trial-bot-management.service';

@Component({
  selector: 'app-trial-bot-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './trial-bot-management.component.html',
  styleUrl: './trial-bot-management.component.css',
})
export class TrialBotManagementComponent implements OnInit {
  trialBots: TrialBot[] = [];

  loading = false;
  errorMessage = '';
  successMessage = '';

  // Add form
  showAddForm = false;
  newBotForm = {
    botId: '',
    noOfDays: 14,
    minUsers: 1,
    maxUsers: 6,
    trialStartDate: this.getTodayInputValue(),
    trialEndDate: this.getDateInputValueFromDays(14),
    trialEndMessage: 'Thanks for using the OFA Agent trial. The trial period has ended. Please purchase the OFA Agent in the cart.',
  };

  // Edit form
  showEditForm = false;
  editingBotId: string | null = null;
  editBotForm = {
    botId: '',
    noOfDays: 14,
    minUsers: 1,
    maxUsers: 6,
    trialStartDate: this.getTodayInputValue(),
    trialEndDate: this.getDateInputValueFromDays(14),
    trialEndMessage: '',
  };

  // Delete confirmation
  showDeleteConfirm = false;
  deletingBotId: string | null = null;

  constructor(
    private readonly trialBotService: TrialBotManagementService,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadTrialBots();
  }

  loadTrialBots(): void {
    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.trialBotService
      .listTrialBots()
      .pipe(
        finalize(() => {
          this.loading = false;
          this.changeDetectorRef.markForCheck();
        }),
      )
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.trialBots = Array.isArray(response.data) ? response.data : [];
            this.successMessage = `Loaded ${this.trialBots.length} trial bot(s)`;
          } else {
            this.errorMessage = response.message || 'Failed to load trial bots';
          }
        },
        error: (error) => {
          this.errorMessage = `Error loading trial bots: ${error?.error?.message || error.message || 'Unknown error'}`;
        },
      });
  }

  addTrialBot(): void {
    if (!this.newBotForm.botId.trim()) {
      this.errorMessage = 'Bot ID is required';
      return;
    }

    if (this.newBotForm.noOfDays <= 0) {
      this.errorMessage = 'Number of days must be greater than 0';
      return;
    }

    if (this.newBotForm.minUsers <= 0) {
      this.errorMessage = 'Minimum users must be greater than 0';
      return;
    }

    if (this.newBotForm.maxUsers <= 0) {
      this.errorMessage = 'Maximum users must be greater than 0';
      return;
    }

    if (this.newBotForm.minUsers > this.newBotForm.maxUsers) {
      this.errorMessage = 'Minimum users cannot be greater than maximum users';
      return;
    }

    if (this.newBotForm.trialEndDate && this.newBotForm.trialStartDate && new Date(this.newBotForm.trialEndDate) < new Date(this.newBotForm.trialStartDate)) {
      this.errorMessage = 'End date cannot be earlier than start date';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.trialBotService
      .addTrialBot({
        ...this.newBotForm,
        minUsers: Number(this.newBotForm.minUsers),
        maxUsers: Number(this.newBotForm.maxUsers),
      })
      .pipe(
        finalize(() => {
          this.loading = false;
          this.changeDetectorRef.markForCheck();
        }),
      )
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.successMessage = `Trial bot ${this.newBotForm.botId} added successfully`;
            this.resetAddForm();
            this.loadTrialBots();
          } else {
            this.errorMessage = response.message || 'Failed to add trial bot';
          }
        },
        error: (error) => {
          this.errorMessage = `Error adding trial bot: ${error?.error?.message || error.message || 'Unknown error'}`;
        },
      });
  }

  startEdit(bot: TrialBot): void {
    this.editingBotId = bot.botId;
    this.editBotForm = {
      botId: bot.botId,
      noOfDays: bot.noOfDays,
      minUsers: bot.minUsers ?? 1,
      maxUsers: bot.maxUsers,
      trialStartDate: bot.trialStartDate ? this.normalizeDateInput(bot.trialStartDate) : this.getTodayInputValue(),
      trialEndDate: bot.trialEndDate ? this.normalizeDateInput(bot.trialEndDate) : this.getDateInputValueFromDays(bot.noOfDays || 14),
      trialEndMessage: bot.trialEndMessage,
    };
    this.showEditForm = true;
    this.errorMessage = '';
  }

  updateTrialBot(): void {
    if (!this.editingBotId) {
      this.errorMessage = 'No bot selected for editing';
      return;
    }

    if (this.editBotForm.noOfDays <= 0) {
      this.errorMessage = 'Number of days must be greater than 0';
      return;
    }

    if (this.editBotForm.minUsers <= 0) {
      this.errorMessage = 'Minimum users must be greater than 0';
      return;
    }

    if (this.editBotForm.maxUsers <= 0) {
      this.errorMessage = 'Maximum users must be greater than 0';
      return;
    }

    if (this.editBotForm.minUsers > this.editBotForm.maxUsers) {
      this.errorMessage = 'Minimum users cannot be greater than maximum users';
      return;
    }

    if (this.editBotForm.trialEndDate && this.editBotForm.trialStartDate && new Date(this.editBotForm.trialEndDate) < new Date(this.editBotForm.trialStartDate)) {
      this.errorMessage = 'End date cannot be earlier than start date';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.trialBotService
      .updateTrialBot(this.editingBotId, {
        noOfDays: this.editBotForm.noOfDays,
        minUsers: Number(this.editBotForm.minUsers),
        maxUsers: Number(this.editBotForm.maxUsers),
        trialStartDate: this.editBotForm.trialStartDate,
        trialEndDate: this.editBotForm.trialEndDate,
        trialEndMessage: this.editBotForm.trialEndMessage,
      })
      .pipe(
        finalize(() => {
          this.loading = false;
          this.changeDetectorRef.markForCheck();
        }),
      )
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.successMessage = `Trial bot ${this.editingBotId} updated successfully`;
            this.resetEditForm();
            this.loadTrialBots();
          } else {
            this.errorMessage = response.message || 'Failed to update trial bot';
          }
        },
        error: (error) => {
          this.errorMessage = `Error updating trial bot: ${error?.error?.message || error.message || 'Unknown error'}`;
        },
      });
  }

  startDelete(botId: string): void {
    this.deletingBotId = botId;
    this.showDeleteConfirm = true;
  }

  confirmDelete(): void {
    if (!this.deletingBotId) {
      this.errorMessage = 'No bot selected for deletion';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.trialBotService
      .removeTrialBot(this.deletingBotId)
      .pipe(
        finalize(() => {
          this.loading = false;
          this.changeDetectorRef.markForCheck();
        }),
      )
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.successMessage = `Trial bot ${this.deletingBotId} removed successfully`;
            this.cancelDelete();
            this.loadTrialBots();
          } else {
            this.errorMessage = response.message || 'Failed to remove trial bot';
          }
        },
        error: (error) => {
          this.errorMessage = `Error removing trial bot: ${error?.error?.message || error.message || 'Unknown error'}`;
        },
      });
  }

  cancelDelete(): void {
    this.showDeleteConfirm = false;
    this.deletingBotId = null;
  }

  resetAddForm(): void {
    this.showAddForm = false;
    this.newBotForm = {
      botId: '',
      noOfDays: 14,
      minUsers: 1,
      maxUsers: 6,
      trialStartDate: this.getTodayInputValue(),
      trialEndDate: this.getDateInputValueFromDays(14),
      trialEndMessage: 'Thanks for using the OFA Agent trial. The trial period has ended. Please purchase the OFA Agent in the cart.',
    };
  }

  resetEditForm(): void {
    this.showEditForm = false;
    this.editingBotId = null;
    this.editBotForm = {
      botId: '',
      noOfDays: 14,
      minUsers: 1,
      maxUsers: 6,
      trialStartDate: this.getTodayInputValue(),
      trialEndDate: this.getDateInputValueFromDays(14),
      trialEndMessage: '',
    };
  }

  syncNewTrialDates(source: 'days' | 'start' | 'end' = 'days'): void {
    const form = this.newBotForm;
    this.syncTrialDates(form, source);
  }

  syncEditTrialDates(source: 'days' | 'start' | 'end' = 'days'): void {
    const form = this.editBotForm;
    this.syncTrialDates(form, source);
  }

  private syncTrialDates(
    form: {
      noOfDays: number;
      trialStartDate: string;
      trialEndDate: string;
    },
    source: 'days' | 'start' | 'end',
  ): void {
    const startDate = form.trialStartDate ? new Date(form.trialStartDate) : null;
    const endDate = form.trialEndDate ? new Date(form.trialEndDate) : null;

    if (source === 'days' && startDate && form.noOfDays > 0) {
      const nextEndDate = new Date(startDate);
      nextEndDate.setDate(nextEndDate.getDate() + Number(form.noOfDays));
      form.trialEndDate = this.normalizeDateInput(nextEndDate);
      return;
    }

    if (source === 'start' && startDate && form.noOfDays > 0) {
      const nextEndDate = new Date(startDate);
      nextEndDate.setDate(nextEndDate.getDate() + Number(form.noOfDays));
      form.trialEndDate = this.normalizeDateInput(nextEndDate);
      return;
    }

    if (source === 'end' && startDate && endDate) {
      const diff = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diff > 0) {
        form.noOfDays = diff;
      }
    }
  }

  private getTodayInputValue(): string {
    const today = new Date();
    return this.normalizeDateInput(today.toISOString());
  }

  private getDateInputValueFromDays(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + Math.max(0, days));
    return this.normalizeDateInput(date.toISOString());
  }

  private normalizeDateInput(value: string | Date): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return this.getTodayInputValue();
    }

    const timezoneOffset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
  }

  getTrialStatus(bot: TrialBot): string {
    if (!bot.trialEndDate) {
      return 'Not started';
    }

    const endDate = new Date(bot.trialEndDate);
    const now = new Date();

    if (now > endDate) {
      return 'Expired';
    }

    const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return `${daysRemaining} days left`;
  }

  getTrialStatusClass(bot: TrialBot): string {
    if (!bot.trialEndDate) {
      return 'status-pending';
    }

    const endDate = new Date(bot.trialEndDate);
    const now = new Date();

    if (now > endDate) {
      return 'status-expired';
    }

    const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysRemaining <= 3) {
      return 'status-warning';
    }

    return 'status-active';
  }
}

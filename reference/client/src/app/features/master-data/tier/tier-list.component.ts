import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { AppDialogService } from '../../../services/app-dialog.service';
import { MasterDataFormMode, MasterDataTier, PaginationState } from '../shared/master-data.types';
import { TierFormComponent } from './tier-form.component';
import { TierService } from './tier.service';

@Component({
  selector: 'app-tier-list',
  standalone: true,
  imports: [CommonModule, FormsModule, TierFormComponent],
  templateUrl: './tier-list.component.html',
  styleUrl: './tier-list.component.css',
})
export class TierListComponent implements OnInit, OnDestroy {
  tiers: MasterDataTier[] = [];
  loading = false;
  saving = false;
  deletingId = '';
  errorMessage = '';
  successMessage = '';
  formErrorMessage = '';
  searchTerm = '';
  selectedTier: MasterDataTier | null = null;
  formMode: MasterDataFormMode = 'create';
  formOpen = false;
  pagination: PaginationState = {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  };
  private successMessageTimeoutId: ReturnType<typeof window.setTimeout> | null = null;

  constructor(
    private readonly appDialogService: AppDialogService,
    private readonly tierService: TierService,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadTiers();
  }

  ngOnDestroy(): void {
    if (this.successMessageTimeoutId !== null) {
      window.clearTimeout(this.successMessageTimeoutId);
    }
  }

  get hasTiers(): boolean {
    return this.tiers.length > 0;
  }

  loadTiers(page = this.pagination.page): void {
    this.loading = true;
    this.errorMessage = '';

    this.tierService.listTiers({
      search: this.searchTerm || undefined,
      page,
      pageSize: this.pagination.pageSize,
    })
      .pipe(finalize(() => {
        this.loading = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.tiers = Array.isArray(response?.data) ? response.data : [];
          if (response?.pagination) {
            this.pagination = response.pagination;
          }
        },
        error: (error) => {
          this.tiers = [];
          this.errorMessage = error?.error?.message || 'Failed to load tiers.';
        },
      });
  }

  openCreate(): void {
    this.formMode = 'create';
    this.selectedTier = null;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  openEdit(tier: MasterDataTier): void {
    this.formMode = 'edit';
    this.selectedTier = tier;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  openView(tier: MasterDataTier): void {
    this.formMode = 'view';
    this.selectedTier = tier;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  closeForm(): void {
    this.formOpen = false;
    this.selectedTier = null;
    this.saving = false;
    this.formErrorMessage = '';
    this.changeDetectorRef.detectChanges();
  }

  onSearch(): void {
    this.loadTiers(1);
  }

  onSave(payload: Partial<MasterDataTier>): void {
    const normalizedTierKey = String(payload.tierKey || '').trim().toUpperCase();
    const hasDuplicateTierKey = this.tiers.some((tier) => (
      tier.id !== this.selectedTier?.id &&
      String(tier.tierKey || '').trim().toUpperCase() === normalizedTierKey
    ));

    if (hasDuplicateTierKey) {
      this.formErrorMessage = 'This tier key already exists. Please choose another one.';
      this.changeDetectorRef.detectChanges();
      return;
    }

    this.saving = true;
    this.formErrorMessage = '';

    const request$ = this.formMode === 'edit' && this.selectedTier
      ? this.tierService.updateTier(this.selectedTier.id, payload)
      : this.tierService.createTier(payload);

    request$
      .pipe(finalize(() => {
        this.saving = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.showSuccessMessage(response?.message || (this.formMode === 'edit'
            ? 'Tier updated successfully.'
            : 'Tier created successfully.'));
          this.closeForm();
          this.loadTiers(this.formMode === 'create' ? 1 : this.pagination.page);
        },
        error: (error) => {
          this.formErrorMessage = this.resolveTierSaveErrorMessage(error);
        },
      });
  }

  onDelete(tier: MasterDataTier): void {
    this.appDialogService.confirm({
      title: 'Delete Tier',
      message: `Delete tier "${tier.tierName}"?`,
      buttonLabel: 'Delete',
      cancelLabel: 'Keep',
      onConfirm: () => {
        this.deletingId = tier.id;
        this.errorMessage = '';
        this.successMessage = '';

        this.tierService.deleteTier(tier.id)
          .pipe(finalize(() => {
            this.deletingId = '';
            this.changeDetectorRef.detectChanges();
          }))
          .subscribe({
            next: (response) => {
              this.showSuccessMessage(response.message);
              this.loadTiers(this.pagination.page);
            },
            error: (error) => {
              this.errorMessage = error?.error?.message || 'Failed to delete tier.';
            },
          });
      },
    });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.pagination.totalPages || page === this.pagination.page) {
      return;
    }

    this.loadTiers(page);
  }

  trackByTierId(_index: number, tier: MasterDataTier): string {
    return tier.id;
  }

  getRowNumber(index: number): number {
    return ((this.pagination.page - 1) * this.pagination.pageSize) + index + 1;
  }

  dismissSuccessMessage(): void {
    this.successMessage = '';

    if (this.successMessageTimeoutId !== null) {
      window.clearTimeout(this.successMessageTimeoutId);
      this.successMessageTimeoutId = null;
    }

    this.changeDetectorRef.detectChanges();
  }

  private resolveTierSaveErrorMessage(error: any): string {
    const message = String(error?.error?.message || '').trim();

    if (message.includes('duplicate key') || message.includes('E11000')) {
      return 'This tier key already exists. Please choose another one.';
    }

    return message || 'Failed to save tier.';
  }

  private showSuccessMessage(message: string): void {
    this.successMessage = message;

    if (this.successMessageTimeoutId !== null) {
      window.clearTimeout(this.successMessageTimeoutId);
    }

    this.successMessageTimeoutId = window.setTimeout(() => {
      this.successMessage = '';
      this.successMessageTimeoutId = null;
      this.changeDetectorRef.detectChanges();
    }, 4500);
  }
}

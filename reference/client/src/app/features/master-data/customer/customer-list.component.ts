import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, finalize } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { AppDialogService } from '../../../services/app-dialog.service';
import { CustomerService } from './customer.service';
import { getCurrentMonthDateRange, getDateRangeError } from '../shared/date-filter.util';
import { CustomerFormComponent } from './customer-form.component';
import { CustomerZohoSyncSummary, MasterDataCustomer, MasterDataFormMode, MasterDataTier, PaginationState } from '../shared/master-data.types';
import { TierService } from '../tier/tier.service';

@Component({
  selector: 'app-customer-list',
  standalone: true,
  imports: [CommonModule, FormsModule, CustomerFormComponent],
  templateUrl: './customer-list.component.html',
  styleUrl: './customer-list.component.css',
})
export class CustomerListComponent implements OnInit, OnDestroy {
  customers: MasterDataCustomer[] = [];
  tiers: MasterDataTier[] = [];
  loading = false;
  saving = false;
  syncingCustomerId = '';
  syncingAllCustomers = false;
  deletingId = '';
  errorMessage = '';
  successMessage = '';
  formErrorMessage = '';
  syncSummary: CustomerZohoSyncSummary | null = null;
  searchTerm = '';
  statusFilter = '';
  dateFrom = getCurrentMonthDateRange().dateFrom;
  dateTo = getCurrentMonthDateRange().dateTo;
  private readonly searchSubject = new Subject<string>();
  private readonly destroy$ = new Subject<void>();
  selectedCustomer: MasterDataCustomer | null = null;
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
    private readonly customerService: CustomerService,
    private readonly tierService: TierService,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(() => this.loadCustomers(1));

    this.loadTiers();
    this.loadSyncSummary();
    this.loadCustomers();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.successMessageTimeoutId !== null) {
      window.clearTimeout(this.successMessageTimeoutId);
    }
  }

  get hasCustomers(): boolean {
    return this.customers.length > 0;
  }

  get existingCustomerCodes(): string[] {
    return this.customers
      .map((customer) => customer.customerCode || '')
      .filter((customerCode) => Boolean(customerCode));
  }

  get syncedCustomersCount(): number {
    return this.syncSummary?.syncedCount ?? 0;
  }

  get pendingCustomersCount(): number {
    return this.syncSummary?.pendingCount ?? 0;
  }

  get failedCustomersCount(): number {
    return this.syncSummary?.failedCount ?? 0;
  }

  get totalCustomersCount(): number {
    return this.syncSummary?.totalCustomers ?? this.pagination.total ?? this.customers.length;
  }

  loadTiers(): void {
    this.tierService.listTiers({ page: 1, pageSize: 100 }).subscribe({
      next: (response) => {
        this.tiers = Array.isArray(response?.data) ? response.data : [];
        this.changeDetectorRef.detectChanges();
      },
      error: () => {
        this.tiers = [];
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  loadCustomers(page = this.pagination.page): void {
    this.loading = true;
    this.errorMessage = '';

    this.customerService.listCustomers({
      search: this.searchTerm || undefined,
      status: this.statusFilter || undefined,
      dateFrom: this.dateFrom || undefined,
      dateTo: this.dateTo || undefined,
      page,
      pageSize: this.pagination.pageSize,
    })
      .pipe(finalize(() => {
        this.loading = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.customers = Array.isArray(response?.data) ? response.data : [];

          if (response?.pagination) {
            this.pagination = response.pagination;
          }

          this.loading = false;
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.customers = [];
          this.errorMessage = error?.error?.message || 'Failed to load customers.';
          this.loading = false;
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  loadSyncSummary(): void {
    this.customerService.getCustomerZohoSyncSummary().subscribe({
      next: (response) => {
        this.syncSummary = response?.data ?? null;
        this.changeDetectorRef.detectChanges();
      },
      error: () => {
        this.syncSummary = null;
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  openCreate(): void {
    this.formMode = 'create';
    this.selectedCustomer = null;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  openEdit(customer: MasterDataCustomer): void {
    this.formMode = 'edit';
    this.selectedCustomer = customer;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  openView(customer: MasterDataCustomer): void {
    this.formMode = 'view';
    this.selectedCustomer = customer;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  closeForm(): void {
    this.formOpen = false;
    this.selectedCustomer = null;
    this.saving = false;
    this.formErrorMessage = '';
    this.changeDetectorRef.detectChanges();
  }

  onSearch(): void {
    this.loadCustomers(1);
  }

  onSearchInput(): void {
    this.searchSubject.next(this.searchTerm);
  }

  onStatusChange(): void {
    this.loadCustomers(1);
  }

  applyDateFilter(): void {
    if (this.hasDateRangeError) {
      return;
    }
    this.loadCustomers(1);
  }

  get dateRangeError(): string {
    return getDateRangeError(this.dateFrom, this.dateTo);
  }

  get hasDateRangeError(): boolean {
    return Boolean(this.dateRangeError);
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.loadCustomers(1);
  }

  clearDates(): void {
    this.dateFrom = '';
    this.dateTo = '';
    this.loadCustomers(1);
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.statusFilter = '';
    this.dateFrom = '';
    this.dateTo = '';
    this.loadCustomers(1);
  }

  onSave(payload: Partial<MasterDataCustomer>): void {
    this.saving = true;
    this.formErrorMessage = '';

    const request$ = this.formMode === 'edit' && this.selectedCustomer
      ? this.customerService.updateCustomer(this.selectedCustomer.id, payload)
      : this.customerService.createCustomer(payload);

    request$
      .pipe(finalize(() => {
        this.saving = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.saving = false;
          this.showSuccessMessage(response?.message || (this.formMode === 'edit'
            ? 'Customer updated successfully.'
            : 'Customer created successfully.'));
          this.closeForm();
          this.loadSyncSummary();
          this.loadCustomers(this.formMode === 'create' ? 1 : this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.saving = false;
          this.formErrorMessage = error?.error?.message || 'Failed to save customer.';
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  syncCustomer(customer: MasterDataCustomer): void {
    if (this.syncingCustomerId === customer.id) {
      return;
    }

    this.syncingCustomerId = customer.id;
    this.errorMessage = '';
    this.successMessage = '';

    this.customerService.syncCustomerToZoho(customer.id)
      .pipe(finalize(() => {
        this.syncingCustomerId = '';
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.showSuccessMessage(response?.message || 'Customer synced successfully.');
          this.loadSyncSummary();
          this.loadCustomers(this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Failed to sync customer to Zoho Books.';
          this.loadSyncSummary();
          this.loadCustomers(this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  syncAllCustomers(): void {
    if (this.syncingAllCustomers) {
      return;
    }

    this.syncingAllCustomers = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.customerService.syncAllCustomersToZoho()
      .pipe(finalize(() => {
        this.syncingAllCustomers = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          const result = response?.data;
          this.showSuccessMessage(result
            ? `Customers sync completed. Synced ${result.syncedCount} of ${result.totalCustomers}.`
            : (response?.message || 'Customers sync completed.'));
          this.loadSyncSummary();
          this.loadCustomers(this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Failed to sync customers to Zoho Books.';
          this.loadSyncSummary();
          this.loadCustomers(this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  onDelete(customer: MasterDataCustomer): void {
    this.appDialogService.confirm({
      title: 'Delete Customer',
      message: `Delete customer "${customer.displayName}"?`,
      buttonLabel: 'Delete',
      cancelLabel: 'Keep',
      onConfirm: () => {
        this.deletingId = customer.id;
        this.errorMessage = '';
        this.successMessage = '';

        this.customerService.deleteCustomer(customer.id)
          .pipe(finalize(() => {
            this.deletingId = '';
            this.changeDetectorRef.detectChanges();
          }))
          .subscribe({
            next: (response) => {
              this.showSuccessMessage(response.message);
              this.loadSyncSummary();
              this.loadCustomers(this.pagination.page);
              this.changeDetectorRef.detectChanges();
            },
            error: (error) => {
              this.errorMessage = error?.error?.message || 'Failed to delete customer.';
              this.changeDetectorRef.detectChanges();
            },
          });
      },
    });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.pagination.totalPages || page === this.pagination.page) {
      return;
    }

    this.loadCustomers(page);
  }

  trackByCustomerId(_index: number, customer: MasterDataCustomer): string {
    return customer.id;
  }

  getRowNumber(index: number): number {
    return ((this.pagination.page - 1) * this.pagination.pageSize) + index + 1;
  }

  getZohoSyncBadgeClass(customer: MasterDataCustomer): string {
    switch (customer.zohoSyncStatus) {
      case 'synced':
        return 'rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold capitalize text-emerald-700';
      case 'failed':
        return 'rounded-full bg-red-50 px-3 py-1 text-xs font-semibold capitalize text-red-700';
      default:
        return 'rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold capitalize text-amber-700';
    }
  }

  getZohoSyncLabel(customer: MasterDataCustomer): string {
    switch (customer.zohoSyncStatus) {
      case 'synced':
        return 'Synced';
      case 'failed':
        return 'Failed';
      default:
        return 'Pending';
    }
  }

  getWorkOrderBadgeClass(customer: MasterDataCustomer): string {
    return customer.hasWorkOrder
      ? 'rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700'
      : 'rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700';
  }

  getWorkOrderBadgeLabel(customer: MasterDataCustomer): string {
    return customer.hasWorkOrder ? 'Has Work Order' : 'No Work Order';
  }

  dismissSuccessMessage(): void {
    this.successMessage = '';

    if (this.successMessageTimeoutId !== null) {
      window.clearTimeout(this.successMessageTimeoutId);
      this.successMessageTimeoutId = null;
    }

    this.changeDetectorRef.detectChanges();
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

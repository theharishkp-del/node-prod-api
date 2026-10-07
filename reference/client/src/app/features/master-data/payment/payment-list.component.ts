import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, finalize } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { AppDialogService } from '../../../services/app-dialog.service';
import { CustomerService } from '../customer/customer.service';
import { InvoiceService } from '../invoice/invoice.service';
import { PaymentService } from './payment.service';
import { getCurrentMonthDateRange, getDateRangeError } from '../shared/date-filter.util';
import { PaymentFormComponent } from './payment-form.component';
import { MasterDataCustomer, MasterDataFormMode, MasterDataInvoice, MasterDataPayment, PaginationState, PaymentZohoSyncSummary } from '../shared/master-data.types';

@Component({
  selector: 'app-payment-list',
  standalone: true,
  imports: [CommonModule, FormsModule, PaymentFormComponent],
  templateUrl: './payment-list.component.html',
  styleUrl: './payment-list.component.css',
})
export class PaymentListComponent implements OnInit, OnDestroy {
  payments: MasterDataPayment[] = [];
  customers: MasterDataCustomer[] = [];
  invoices: MasterDataInvoice[] = [];
  loading = false;
  saving = false;
  syncingPaymentId = '';
  syncingAllPayments = false;
  deletingId = '';
  errorMessage = '';
  successMessage = '';
  formErrorMessage = '';
  syncSummary: PaymentZohoSyncSummary | null = null;
  searchTerm = '';
  statusFilter = '';
  dateFrom = getCurrentMonthDateRange().dateFrom;
  dateTo = getCurrentMonthDateRange().dateTo;
  private readonly searchSubject = new Subject<string>();
  private readonly destroy$ = new Subject<void>();
  selectedPayment: MasterDataPayment | null = null;
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
    private readonly paymentService: PaymentService,
    private readonly customerService: CustomerService,
    private readonly invoiceService: InvoiceService,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(() => this.loadPayments(1));

    this.loadReferenceData();
    this.loadSyncSummary();
    this.loadPayments();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.successMessageTimeoutId !== null) {
      window.clearTimeout(this.successMessageTimeoutId);
    }
  }

  get hasPayments(): boolean {
    return this.payments.length > 0;
  }

  get existingPaymentNumbers(): string[] {
    return this.payments
      .map((payment) => payment.paymentNumber || '')
      .filter((paymentNumber) => Boolean(paymentNumber));
  }

  get syncedPaymentsCount(): number {
    return this.syncSummary?.syncedCount ?? 0;
  }

  get pendingPaymentsCount(): number {
    return this.syncSummary?.pendingCount ?? 0;
  }

  get failedPaymentsCount(): number {
    return this.syncSummary?.failedCount ?? 0;
  }

  get totalPaymentsCount(): number {
    return this.syncSummary?.totalPayments ?? this.pagination.total ?? this.payments.length;
  }

  loadReferenceData(): void {
    this.customerService.listCustomers({ page: 1, pageSize: 100, status: 'active' }).subscribe({
      next: (response) => {
        this.customers = Array.isArray(response?.data) ? response.data : [];
        this.changeDetectorRef.detectChanges();
      },
      error: () => {
        this.customers = [];
        this.changeDetectorRef.detectChanges();
      },
    });
    this.invoiceService.listInvoices({ page: 1, pageSize: 100 }).subscribe({
      next: (response) => {
        this.invoices = Array.isArray(response?.data) ? response.data : [];
        this.changeDetectorRef.detectChanges();
      },
      error: () => {
        this.invoices = [];
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  loadPayments(page = this.pagination.page): void {
    this.loading = true;
    this.errorMessage = '';

    this.paymentService.listPayments({
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
          this.payments = Array.isArray(response?.data) ? response.data : [];

          if (response?.pagination) {
            this.pagination = response.pagination;
          }

          this.loading = false;
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.payments = [];
          this.errorMessage = error?.error?.message || 'Failed to load payments.';
          this.loading = false;
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  loadSyncSummary(): void {
    this.paymentService.getPaymentZohoSyncSummary().subscribe({
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
    this.loadReferenceData();
    this.formMode = 'create';
    this.selectedPayment = null;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  openEdit(payment: MasterDataPayment): void {
    this.loadReferenceData();
    this.formMode = 'edit';
    this.selectedPayment = payment;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  openView(payment: MasterDataPayment): void {
    this.loadReferenceData();
    this.formMode = 'view';
    this.selectedPayment = payment;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  closeForm(): void {
    this.formOpen = false;
    this.selectedPayment = null;
    this.saving = false;
    this.formErrorMessage = '';
    this.changeDetectorRef.detectChanges();
  }

  onSave(payload: Partial<MasterDataPayment>): void {
    this.saving = true;
    this.formErrorMessage = '';

    const request$ = this.formMode === 'edit' && this.selectedPayment
      ? this.paymentService.updatePayment(this.selectedPayment.id, payload)
      : this.paymentService.createPayment(payload);

    request$
      .pipe(finalize(() => {
        this.saving = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.showSuccessMessage(response?.message || (this.formMode === 'edit'
            ? 'Payment updated successfully.'
            : 'Payment created successfully.'));
          this.closeForm();
          this.loadReferenceData();
          this.loadSyncSummary();
          this.loadPayments(this.formMode === 'create' ? 1 : this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.formErrorMessage = error?.error?.message || 'Failed to save payment.';
          this.saving = false;
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  syncPayment(payment: MasterDataPayment): void {
    if (this.syncingPaymentId === payment.id) {
      return;
    }

    this.syncingPaymentId = payment.id;
    this.errorMessage = '';
    this.successMessage = '';

    this.paymentService.syncPaymentToZoho(payment.id)
      .pipe(finalize(() => {
        this.syncingPaymentId = '';
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.showSuccessMessage(response?.message || 'Payment synced successfully.');
          this.loadReferenceData();
          this.loadSyncSummary();
          this.loadPayments(this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Failed to sync payment to Zoho Books.';
          this.loadSyncSummary();
          this.loadPayments(this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  syncAllPayments(): void {
    if (this.syncingAllPayments) {
      return;
    }

    this.syncingAllPayments = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.paymentService.syncAllPaymentsToZoho()
      .pipe(finalize(() => {
        this.syncingAllPayments = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          const result = response?.data;
          this.showSuccessMessage(result
            ? `Payments sync completed. Synced ${result.syncedCount} of ${result.totalPayments}.`
            : (response?.message || 'Payments sync completed.'));
          this.loadReferenceData();
          this.loadSyncSummary();
          this.loadPayments(this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Failed to sync payments to Zoho Books.';
          this.loadSyncSummary();
          this.loadPayments(this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  onDelete(payment: MasterDataPayment): void {
    this.appDialogService.confirm({
      title: 'Delete Payment',
      message: `Delete payment "${payment.paymentNumber}"?`,
      buttonLabel: 'Delete',
      cancelLabel: 'Keep',
      onConfirm: () => {
        this.deletingId = payment.id;
        this.paymentService.deletePayment(payment.id)
          .pipe(finalize(() => {
            this.deletingId = '';
            this.changeDetectorRef.detectChanges();
          }))
          .subscribe({
            next: (response) => {
              this.showSuccessMessage(response.message);
              this.loadReferenceData();
              this.loadSyncSummary();
              this.loadPayments(this.pagination.page);
              this.changeDetectorRef.detectChanges();
            },
            error: (error) => {
              this.errorMessage = error?.error?.message || 'Failed to delete payment.';
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

    this.loadPayments(page);
  }

  trackByPaymentId(_index: number, payment: MasterDataPayment): string {
    return payment.id;
  }

  onSearchInput(): void {
    this.searchSubject.next(this.searchTerm);
  }

  onStatusChange(): void {
    this.loadPayments(1);
  }

  applyDateFilter(): void {
    if (this.hasDateRangeError) {
      return;
    }
    this.loadPayments(1);
  }

  get dateRangeError(): string {
    return getDateRangeError(this.dateFrom, this.dateTo);
  }

  get hasDateRangeError(): boolean {
    return Boolean(this.dateRangeError);
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.loadPayments(1);
  }

  clearDates(): void {
    this.dateFrom = '';
    this.dateTo = '';
    this.loadPayments(1);
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.statusFilter = '';
    this.dateFrom = '';
    this.dateTo = '';
    this.loadPayments(1);
  }

  getRowNumber(index: number): number {
    return ((this.pagination.page - 1) * this.pagination.pageSize) + index + 1;
  }

  getZohoSyncBadgeClass(payment: MasterDataPayment): string {
    switch (payment.zohoSyncStatus) {
      case 'synced':
        return 'rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold capitalize text-emerald-700';
      case 'failed':
        return 'rounded-full bg-red-50 px-3 py-1 text-xs font-semibold capitalize text-red-700';
      default:
        return 'rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold capitalize text-amber-700';
    }
  }

  getZohoSyncLabel(payment: MasterDataPayment): string {
    switch (payment.zohoSyncStatus) {
      case 'synced':
        return 'Synced';
      case 'failed':
        return 'Failed';
      default:
        return 'Pending';
    }
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

import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, finalize } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { AppDialogService } from '../../../services/app-dialog.service';
import { CustomerService } from '../customer/customer.service';
import { QuoteService } from '../quote/quote.service';
import { InvoiceService } from './invoice.service';
import { getCurrentMonthDateRange, getDateRangeError } from '../shared/date-filter.util';
import { InvoiceFormComponent } from './invoice-form.component';
import { InvoiceZohoSyncSummary, MasterDataCustomer, MasterDataFormMode, MasterDataInvoice, MasterDataQuote, PaginationState } from '../shared/master-data.types';

@Component({
  selector: 'app-invoice-list',
  standalone: true,
  imports: [CommonModule, FormsModule, InvoiceFormComponent],
  templateUrl: './invoice-list.component.html',
  styleUrl: './invoice-list.component.css',
})
export class InvoiceListComponent implements OnInit, OnDestroy {
  invoices: MasterDataInvoice[] = [];
  customers: MasterDataCustomer[] = [];
  quotes: MasterDataQuote[] = [];
  loading = false;
  saving = false;
  syncingInvoiceId = '';
  downloadingInvoiceId = '';
  syncingAllInvoices = false;
  deletingId = '';
  errorMessage = '';
  successMessage = '';
  formErrorMessage = '';
  syncSummary: InvoiceZohoSyncSummary | null = null;
  searchTerm = '';
  statusFilter = '';
  dateFrom = getCurrentMonthDateRange().dateFrom;
  dateTo = getCurrentMonthDateRange().dateTo;
  private readonly searchSubject = new Subject<string>();
  private readonly destroy$ = new Subject<void>();
  selectedInvoice: MasterDataInvoice | null = null;
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
    private readonly invoiceService: InvoiceService,
    private readonly customerService: CustomerService,
    private readonly quoteService: QuoteService,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(() => this.loadInvoices(1));

    this.loadReferenceData();
    this.loadSyncSummary();
    this.loadInvoices();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.successMessageTimeoutId !== null) {
      window.clearTimeout(this.successMessageTimeoutId);
    }
  }

  get hasInvoices(): boolean {
    return this.invoices.length > 0;
  }

  get existingInvoiceNumbers(): string[] {
    return this.invoices
      .map((invoice) => invoice.invoiceNumber || '')
      .filter((invoiceNumber) => Boolean(invoiceNumber));
  }

  get syncedInvoicesCount(): number {
    return this.syncSummary?.syncedCount ?? 0;
  }

  get pendingInvoicesCount(): number {
    return this.syncSummary?.pendingCount ?? 0;
  }

  get failedInvoicesCount(): number {
    return this.syncSummary?.failedCount ?? 0;
  }

  get totalInvoicesCount(): number {
    return this.syncSummary?.totalInvoices ?? this.pagination.total ?? this.invoices.length;
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
    this.quoteService.listQuotes({ page: 1, pageSize: 100 }).subscribe({
      next: (response) => {
        this.quotes = Array.isArray(response?.data) ? response.data : [];
        this.changeDetectorRef.detectChanges();
      },
      error: () => {
        this.quotes = [];
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  loadInvoices(page = this.pagination.page): void {
    this.loading = true;
    this.errorMessage = '';

    this.invoiceService.listInvoices({
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
          this.invoices = Array.isArray(response?.data) ? response.data : [];

          if (response?.pagination) {
            this.pagination = response.pagination;
          }

          this.loading = false;
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.invoices = [];
          this.errorMessage = error?.error?.message || 'Failed to load invoices.';
          this.loading = false;
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  loadSyncSummary(): void {
    this.invoiceService.getInvoiceZohoSyncSummary().subscribe({
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
    this.selectedInvoice = null;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  openEdit(invoice: MasterDataInvoice): void {
    this.formMode = 'edit';
    this.selectedInvoice = invoice;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  openView(invoice: MasterDataInvoice): void {
    this.formMode = 'view';
    this.selectedInvoice = invoice;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  closeForm(): void {
    this.formOpen = false;
    this.selectedInvoice = null;
    this.saving = false;
    this.formErrorMessage = '';
    this.changeDetectorRef.detectChanges();
  }

  onSave(payload: Partial<MasterDataInvoice>): void {
    this.saving = true;
    this.formErrorMessage = '';

    const request$ = this.formMode === 'edit' && this.selectedInvoice
      ? this.invoiceService.updateInvoice(this.selectedInvoice.id, payload)
      : this.invoiceService.createInvoice(payload);

    request$
      .pipe(finalize(() => {
        this.saving = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.showSuccessMessage(response?.message || (this.formMode === 'edit'
            ? 'Invoice updated successfully.'
            : 'Invoice created successfully.'));
          this.closeForm();
          this.loadSyncSummary();
          this.loadInvoices(this.formMode === 'create' ? 1 : this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.formErrorMessage = error?.error?.message || 'Failed to save invoice.';
          this.saving = false;
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  syncInvoice(invoice: MasterDataInvoice): void {
    if (this.syncingInvoiceId === invoice.id) {
      return;
    }

    this.syncingInvoiceId = invoice.id;
    this.errorMessage = '';
    this.successMessage = '';

    this.invoiceService.syncInvoiceToZoho(invoice.id)
      .pipe(finalize(() => {
        this.syncingInvoiceId = '';
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.showSuccessMessage(response?.message || 'Invoice synced successfully.');
          this.loadSyncSummary();
          this.loadInvoices(this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Failed to sync invoice to Zoho Books.';
          this.loadSyncSummary();
          this.loadInvoices(this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  syncAllInvoices(): void {
    if (this.syncingAllInvoices) {
      return;
    }

    this.syncingAllInvoices = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.invoiceService.syncAllInvoicesToZoho()
      .pipe(finalize(() => {
        this.syncingAllInvoices = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          const result = response?.data;
          this.showSuccessMessage(result
            ? `Invoices sync completed. Synced ${result.syncedCount} of ${result.totalInvoices}.`
            : (response?.message || 'Invoices sync completed.'));
          this.loadSyncSummary();
          this.loadInvoices(this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Failed to sync invoices to Zoho Books.';
          this.loadSyncSummary();
          this.loadInvoices(this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  onDelete(invoice: MasterDataInvoice): void {
    this.appDialogService.confirm({
      title: 'Delete Invoice',
      message: `Delete invoice "${invoice.invoiceNumber}"?`,
      buttonLabel: 'Delete',
      cancelLabel: 'Keep',
      onConfirm: () => {
        this.deletingId = invoice.id;
        this.invoiceService.deleteInvoice(invoice.id)
          .pipe(finalize(() => {
            this.deletingId = '';
            this.changeDetectorRef.detectChanges();
          }))
          .subscribe({
            next: (response) => {
              this.showSuccessMessage(response.message);
              this.loadSyncSummary();
              this.loadInvoices(this.pagination.page);
              this.changeDetectorRef.detectChanges();
            },
            error: (error) => {
              this.errorMessage = error?.error?.message || 'Failed to delete invoice.';
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

    this.loadInvoices(page);
  }

  trackByInvoiceId(_index: number, invoice: MasterDataInvoice): string {
    return invoice.id;
  }

  onSearchInput(): void {
    this.searchSubject.next(this.searchTerm);
  }

  onStatusChange(): void {
    this.loadInvoices(1);
  }

  applyDateFilter(): void {
    if (this.hasDateRangeError) {
      return;
    }
    this.loadInvoices(1);
  }

  get dateRangeError(): string {
    return getDateRangeError(this.dateFrom, this.dateTo);
  }

  get hasDateRangeError(): boolean {
    return Boolean(this.dateRangeError);
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.loadInvoices(1);
  }

  clearDates(): void {
    this.dateFrom = '';
    this.dateTo = '';
    this.loadInvoices(1);
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.statusFilter = '';
    this.dateFrom = '';
    this.dateTo = '';
    this.loadInvoices(1);
  }

  getRowNumber(index: number): number {
    return ((this.pagination.page - 1) * this.pagination.pageSize) + index + 1;
  }

  viewInvoicePdf(invoice: MasterDataInvoice): void {
    if (this.downloadingInvoiceId === invoice.id) {
      return;
    }

    this.downloadingInvoiceId = invoice.id;
    this.errorMessage = '';
    this.successMessage = '';

    const downloadPdf = () => {
      this.invoiceService.getInvoicePdf(invoice.id)
        .pipe(finalize(() => {
          this.downloadingInvoiceId = '';
          this.changeDetectorRef.detectChanges();
        }))
        .subscribe({
          next: (blob) => {
            const objectUrl = URL.createObjectURL(blob);
            window.open(objectUrl, '_blank', 'noopener,noreferrer');
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
            this.showSuccessMessage('Invoice PDF opened successfully.');
            this.changeDetectorRef.detectChanges();
          },
          error: (error) => {
            this.errorMessage = error?.error?.message || 'Failed to load invoice PDF.';
            this.changeDetectorRef.detectChanges();
          },
        });
    };

    const needsSync = !invoice.zohoInvoiceId || invoice.zohoSyncStatus !== 'synced';

    if (!needsSync) {
      downloadPdf();
      return;
    }

    this.invoiceService.syncInvoiceToZoho(invoice.id).subscribe({
      next: () => {
        this.loadSyncSummary();
        this.loadInvoices(this.pagination.page);
        downloadPdf();
      },
      error: (error) => {
        this.downloadingInvoiceId = '';
        this.errorMessage = error?.error?.message || 'Failed to sync invoice before loading PDF.';
        this.loadSyncSummary();
        this.loadInvoices(this.pagination.page);
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  getZohoSyncBadgeClass(invoice: MasterDataInvoice): string {
    switch (invoice.zohoSyncStatus) {
      case 'synced':
        return 'rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold capitalize text-emerald-700';
      case 'failed':
        return 'rounded-full bg-red-50 px-3 py-1 text-xs font-semibold capitalize text-red-700';
      default:
        return 'rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold capitalize text-amber-700';
    }
  }

  getZohoSyncLabel(invoice: MasterDataInvoice): string {
    switch (invoice.zohoSyncStatus) {
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

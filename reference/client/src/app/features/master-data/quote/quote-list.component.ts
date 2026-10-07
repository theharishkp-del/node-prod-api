import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, finalize } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { AppDialogService } from '../../../services/app-dialog.service';
import { CustomerService } from '../customer/customer.service';
import { QuoteService } from './quote.service';
import { getCurrentMonthDateRange, getDateRangeError } from '../shared/date-filter.util';
import { QuoteFormComponent } from './quote-form.component';
import { MasterDataCustomer, MasterDataFormMode, MasterDataQuote, PaginationState, QuoteZohoSyncSummary } from '../shared/master-data.types';

@Component({
  selector: 'app-quote-list',
  standalone: true,
  imports: [CommonModule, FormsModule, QuoteFormComponent],
  templateUrl: './quote-list.component.html',
  styleUrl: './quote-list.component.css',
})
export class QuoteListComponent implements OnInit, OnDestroy {
  quotes: MasterDataQuote[] = [];
  customers: MasterDataCustomer[] = [];
  loading = false;
  saving = false;
  syncingQuoteId = '';
  downloadingQuoteId = '';
  syncingAllQuotes = false;
  deletingId = '';
  errorMessage = '';
  successMessage = '';
  formErrorMessage = '';
  syncSummary: QuoteZohoSyncSummary | null = null;
  searchTerm = '';
  statusFilter = '';
  dateFrom = getCurrentMonthDateRange().dateFrom;
  dateTo = getCurrentMonthDateRange().dateTo;
  private readonly searchSubject = new Subject<string>();
  private readonly destroy$ = new Subject<void>();
  selectedQuote: MasterDataQuote | null = null;
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
    private readonly quoteService: QuoteService,
    private readonly customerService: CustomerService,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(() => this.loadQuotes(1));

    this.loadCustomers();
    this.loadSyncSummary();
    this.loadQuotes();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.successMessageTimeoutId !== null) {
      window.clearTimeout(this.successMessageTimeoutId);
    }
  }

  get hasQuotes(): boolean {
    return this.quotes.length > 0;
  }

  get existingQuoteNumbers(): string[] {
    return this.quotes
      .map((quote) => quote.quoteNumber || '')
      .filter((quoteNumber) => Boolean(quoteNumber));
  }

  get syncedQuotesCount(): number {
    return this.syncSummary?.syncedCount ?? 0;
  }

  get pendingQuotesCount(): number {
    return this.syncSummary?.pendingCount ?? 0;
  }

  get failedQuotesCount(): number {
    return this.syncSummary?.failedCount ?? 0;
  }

  get totalQuotesCount(): number {
    return this.syncSummary?.totalQuotes ?? this.pagination.total ?? this.quotes.length;
  }

  loadCustomers(): void {
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
  }

  loadQuotes(page = this.pagination.page): void {
    this.loading = true;
    this.errorMessage = '';

    this.quoteService.listQuotes({
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
          this.quotes = Array.isArray(response?.data) ? response.data : [];

          if (response?.pagination) {
            this.pagination = response.pagination;
          }

          this.loading = false;
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.quotes = [];
          this.errorMessage = error?.error?.message || 'Failed to load quotes.';
          this.loading = false;
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  loadSyncSummary(): void {
    this.quoteService.getQuoteZohoSyncSummary().subscribe({
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
    this.selectedQuote = null;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  openEdit(quote: MasterDataQuote): void {
    this.formMode = 'edit';
    this.selectedQuote = quote;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  openView(quote: MasterDataQuote): void {
    this.formMode = 'view';
    this.selectedQuote = quote;
    this.formErrorMessage = '';
    this.formOpen = true;
  }

  closeForm(): void {
    this.formOpen = false;
    this.selectedQuote = null;
    this.saving = false;
    this.formErrorMessage = '';
    this.changeDetectorRef.detectChanges();
  }

  onSave(payload: Partial<MasterDataQuote>): void {
    this.saving = true;
    this.formErrorMessage = '';

    const request$ = this.formMode === 'edit' && this.selectedQuote
      ? this.quoteService.updateQuote(this.selectedQuote.id, payload)
      : this.quoteService.createQuote(payload);

    request$
      .pipe(finalize(() => {
        this.saving = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.showSuccessMessage(response?.message || (this.formMode === 'edit'
            ? 'Quote updated successfully.'
            : 'Quote created successfully.'));
          this.closeForm();
          this.loadSyncSummary();
          this.loadQuotes(this.formMode === 'create' ? 1 : this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.formErrorMessage = error?.error?.message || 'Failed to save quote.';
          this.saving = false;
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  syncQuote(quote: MasterDataQuote): void {
    if (this.syncingQuoteId === quote.id) {
      return;
    }

    this.syncingQuoteId = quote.id;
    this.errorMessage = '';
    this.successMessage = '';

    this.quoteService.syncQuoteToZoho(quote.id)
      .pipe(finalize(() => {
        this.syncingQuoteId = '';
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.showSuccessMessage(response?.message || 'Quote synced successfully.');
          this.loadSyncSummary();
          this.loadQuotes(this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Failed to sync quote to Zoho Books.';
          this.loadSyncSummary();
          this.loadQuotes(this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  syncAllQuotes(): void {
    if (this.syncingAllQuotes) {
      return;
    }

    this.syncingAllQuotes = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.quoteService.syncAllQuotesToZoho()
      .pipe(finalize(() => {
        this.syncingAllQuotes = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          const result = response?.data;
          this.showSuccessMessage(result
            ? `Quotes sync completed. Synced ${result.syncedCount} of ${result.totalQuotes}.`
            : (response?.message || 'Quotes sync completed.'));
          this.loadSyncSummary();
          this.loadQuotes(this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Failed to sync quotes to Zoho Books.';
          this.loadSyncSummary();
          this.loadQuotes(this.pagination.page);
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  onDelete(quote: MasterDataQuote): void {
    this.appDialogService.confirm({
      title: 'Delete Quote',
      message: `Delete quote "${quote.quoteNumber}"?`,
      buttonLabel: 'Delete',
      cancelLabel: 'Keep',
      onConfirm: () => {
        this.deletingId = quote.id;
        this.quoteService.deleteQuote(quote.id)
          .pipe(finalize(() => {
            this.deletingId = '';
            this.changeDetectorRef.detectChanges();
          }))
          .subscribe({
            next: (response) => {
              this.showSuccessMessage(response.message);
              this.loadSyncSummary();
              this.loadQuotes(this.pagination.page);
              this.changeDetectorRef.detectChanges();
            },
            error: (error) => {
              this.errorMessage = error?.error?.message || 'Failed to delete quote.';
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

    this.loadQuotes(page);
  }

  trackByQuoteId(_index: number, quote: MasterDataQuote): string {
    return quote.id;
  }

  onSearchInput(): void {
    this.searchSubject.next(this.searchTerm);
  }

  onStatusChange(): void {
    this.loadQuotes(1);
  }

  applyDateFilter(): void {
    if (this.hasDateRangeError) {
      return;
    }
    this.loadQuotes(1);
  }

  get dateRangeError(): string {
    return getDateRangeError(this.dateFrom, this.dateTo);
  }

  get hasDateRangeError(): boolean {
    return Boolean(this.dateRangeError);
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.loadQuotes(1);
  }

  clearDates(): void {
    this.dateFrom = '';
    this.dateTo = '';
    this.loadQuotes(1);
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.statusFilter = '';
    this.dateFrom = '';
    this.dateTo = '';
    this.loadQuotes(1);
  }

  getRowNumber(index: number): number {
    return ((this.pagination.page - 1) * this.pagination.pageSize) + index + 1;
  }

  viewQuotePdf(quote: MasterDataQuote): void {
    if (this.downloadingQuoteId === quote.id) {
      return;
    }

    this.downloadingQuoteId = quote.id;
    this.errorMessage = '';
    this.successMessage = '';

    const downloadPdf = () => {
      this.quoteService.getQuotePdf(quote.id)
        .pipe(finalize(() => {
          this.downloadingQuoteId = '';
          this.changeDetectorRef.detectChanges();
        }))
        .subscribe({
          next: (blob) => {
            const objectUrl = URL.createObjectURL(blob);
            window.open(objectUrl, '_blank', 'noopener,noreferrer');
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
            this.showSuccessMessage('Quote PDF opened successfully.');
            this.changeDetectorRef.detectChanges();
          },
          error: (error) => {
            this.errorMessage = error?.error?.message || 'Failed to load quote PDF.';
            this.changeDetectorRef.detectChanges();
          },
        });
    };

    const needsSync = !quote.zohoEstimateId || quote.zohoSyncStatus !== 'synced';

    if (!needsSync) {
      downloadPdf();
      return;
    }

    this.quoteService.syncQuoteToZoho(quote.id).subscribe({
      next: () => {
        this.loadSyncSummary();
        this.loadQuotes(this.pagination.page);
        downloadPdf();
      },
      error: (error) => {
        this.downloadingQuoteId = '';
        this.errorMessage = error?.error?.message || 'Failed to sync quote before loading PDF.';
        this.loadSyncSummary();
        this.loadQuotes(this.pagination.page);
        this.changeDetectorRef.detectChanges();
      },
    });
  }

  getZohoSyncBadgeClass(quote: MasterDataQuote): string {
    switch (quote.zohoSyncStatus) {
      case 'synced':
        return 'rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold capitalize text-emerald-700';
      case 'failed':
        return 'rounded-full bg-red-50 px-3 py-1 text-xs font-semibold capitalize text-red-700';
      default:
        return 'rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold capitalize text-amber-700';
    }
  }

  getZohoSyncLabel(quote: MasterDataQuote): string {
    switch (quote.zohoSyncStatus) {
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

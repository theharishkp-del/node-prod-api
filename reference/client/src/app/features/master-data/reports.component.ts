import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, finalize } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { ReportsService } from './reports.service';
import {
  MasterDataCustomer,
  MasterDataInvoice,
  MasterDataWorkOrder,
  PaginationState,
  ReportDownloadQuery,
} from './shared/master-data.types';

type ReportKey = 'customers' | 'invoices' | 'work-orders';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.css',
})
export class ReportsComponent implements OnInit, OnDestroy {
  loadingPreview = false;
  searchTerm = '';
  dateFrom = '';
  dateTo = '';
  errorMessage = '';
  customerRows: MasterDataCustomer[] = [];
  invoiceRows: MasterDataInvoice[] = [];
  workOrderRows: MasterDataWorkOrder[] = [];
  downloadingKey: ReportKey | '' = '';
  activeReport: ReportKey = 'customers';
  pagination: PaginationState = {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  };

  private readonly searchSubject = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  readonly reportTabs: Array<{ key: ReportKey; label: string }> = [
    { key: 'customers',   label: 'Customer Report' },
    { key: 'invoices',    label: 'Invoice Report' },
    { key: 'work-orders', label: 'Work Order Report' },
  ];

  constructor(
    private readonly reportsService: ReportsService,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(() => this.loadPreview(1));

    this.loadPreview();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchInput(): void {
    this.searchSubject.next(this.searchTerm);
  }

  setActiveReport(report: ReportKey): void {
    if (this.activeReport === report) return;
    this.activeReport = report;
    this.loadPreview(1);
  }

  applyDateFilter(): void {
    if (this.hasDateRangeError) return;
    this.loadPreview(1);
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.dateFrom = '';
    this.dateTo = '';
    this.loadPreview(1);
  }

  downloadReport(): void {
    if (this.downloadingKey) return;

    const query = this.buildQuery();
    this.downloadingKey = this.activeReport;
    this.errorMessage = '';

    const request =
      this.activeReport === 'customers'
        ? this.reportsService.downloadCustomerReport(query)
        : this.activeReport === 'invoices'
          ? this.reportsService.downloadInvoiceReport(query)
          : this.reportsService.downloadWorkOrderReport(query);

    request
      .pipe(finalize(() => {
        this.downloadingKey = '';
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (blob) => {
          const prefix = this.activeReport === 'customers'
            ? 'customer-report'
            : this.activeReport === 'invoices'
              ? 'invoice-report'
              : 'work-order-report';
          const suffix = this.dateFrom && this.dateTo
            ? `${this.dateFrom}_to_${this.dateTo}`
            : new Date().toISOString().slice(0, 10);
          const fileName = `${prefix}-${suffix}.xlsx`;
          const objectUrl = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = objectUrl;
          anchor.download = fileName;
          anchor.click();
          URL.revokeObjectURL(objectUrl);
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Failed to download report.';
        },
      });
  }

  loadPreview(page = this.pagination.page): void {
    const query = this.buildQuery(page);
    this.loadingPreview = true;
    this.errorMessage = '';

    const clearRows = () => {
      this.customerRows = [];
      this.invoiceRows = [];
      this.workOrderRows = [];
    };

    if (this.activeReport === 'customers') {
      this.reportsService.previewCustomerReport(query)
        .pipe(finalize(() => { this.loadingPreview = false; this.changeDetectorRef.detectChanges(); }))
        .subscribe({
          next: (res) => { clearRows(); this.customerRows = Array.isArray(res?.data) ? res.data : []; this.pagination = res?.pagination || this.pagination; },
          error: (err) => { clearRows(); this.errorMessage = err?.error?.message || 'Failed to load report.'; },
        });
      return;
    }

    if (this.activeReport === 'invoices') {
      this.reportsService.previewInvoiceReport(query)
        .pipe(finalize(() => { this.loadingPreview = false; this.changeDetectorRef.detectChanges(); }))
        .subscribe({
          next: (res) => { clearRows(); this.invoiceRows = Array.isArray(res?.data) ? res.data : []; this.pagination = res?.pagination || this.pagination; },
          error: (err) => { clearRows(); this.errorMessage = err?.error?.message || 'Failed to load report.'; },
        });
      return;
    }

    this.reportsService.previewWorkOrderReport(query)
      .pipe(finalize(() => { this.loadingPreview = false; this.changeDetectorRef.detectChanges(); }))
      .subscribe({
        next: (res) => { clearRows(); this.workOrderRows = Array.isArray(res?.data) ? res.data : []; this.pagination = res?.pagination || this.pagination; },
        error: (err) => { clearRows(); this.errorMessage = err?.error?.message || 'Failed to load report.'; },
      });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.pagination.totalPages || page === this.pagination.page) return;
    this.loadPreview(page);
  }

  getRowNumber(index: number): number {
    return ((this.pagination.page - 1) * this.pagination.pageSize) + index + 1;
  }

  get activeTabLabel(): string {
    return this.reportTabs.find((t) => t.key === this.activeReport)?.label || 'Report';
  }

  get hasRows(): boolean {
    if (this.activeReport === 'customers') return this.customerRows.length > 0;
    if (this.activeReport === 'invoices') return this.invoiceRows.length > 0;
    return this.workOrderRows.length > 0;
  }

  get hasActiveFilters(): boolean {
    return Boolean(this.searchTerm || this.dateFrom || this.dateTo);
  }

  get emptyStateMessage(): string {
    if (this.activeReport === 'customers') return 'No customer records found.';
    if (this.activeReport === 'invoices') return 'No invoice records found.';
    return 'No work order records found.';
  }

  getStatusClass(status = ''): string {
    const s = String(status || '').trim().toLowerCase();
    if (['active', 'accepted', 'paid', 'success', 'completed'].includes(s)) return 'report-status report-status-success';
    if (['pending', 'draft', 'sent', 'open', 'partially_paid', 'in_progress'].includes(s)) return 'report-status report-status-warning';
    if (['inactive', 'failed', 'cancelled', 'void', 'declined', 'expired', 'refunded', 'overdue'].includes(s)) return 'report-status report-status-muted';
    return 'report-status report-status-default';
  }

  private buildQuery(page = 1): ReportDownloadQuery {
    const hasDateRange = Boolean(this.dateFrom && this.dateTo);
    return {
      search: this.searchTerm || undefined,
      period: hasDateRange ? 'custom' : undefined,
      from: hasDateRange ? this.dateFrom : undefined,
      to: hasDateRange ? this.dateTo : undefined,
      page,
      pageSize: this.pagination.pageSize,
    } as ReportDownloadQuery;
  }

  get dateRangeError(): string {
    if (this.dateFrom && this.dateTo && this.dateFrom > this.dateTo) {
      return '"From" date must be on or before "To" date.';
    }
    if (this.dateTo && !this.dateFrom) {
      return 'Please set a "From" date.';
    }
    if (this.dateFrom && !this.dateTo) {
      return 'Please set a "To" date.';
    }
    return '';
  }

  get hasDateRangeError(): boolean {
    return Boolean(this.dateRangeError);
  }
}

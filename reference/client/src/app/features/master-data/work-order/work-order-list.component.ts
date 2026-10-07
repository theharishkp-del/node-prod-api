import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, finalize } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';
import {
  AdminCalendarWorkOrderDetails,
  MasterDataListQuery,
  MasterDataWorkOrder,
  PaginationState,
} from '../shared/master-data.types';
import { WorkOrderService } from './work-order.service';
import { getCurrentMonthDateRange, getDateRangeError } from '../shared/date-filter.util';

@Component({
  selector: 'app-work-order-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './work-order-list.component.html',
  styleUrl: './work-order-list.component.css',
})
export class WorkOrderListComponent implements OnInit, OnDestroy {
  workOrders: MasterDataWorkOrder[] = [];
  loading = false;
  errorMessage = '';
  searchTerm = '';
  statusFilter = '';
  paymentStatusFilter = '';
  dateFrom = getCurrentMonthDateRange().dateFrom;
  dateTo = getCurrentMonthDateRange().dateTo;
  selectedWorkOrder: MasterDataWorkOrder | null = null;
  workOrderDetails: AdminCalendarWorkOrderDetails | null = null;
  detailsLoading = false;
  detailsError = '';
  private readonly searchSubject = new Subject<string>();
  private readonly destroy$ = new Subject<void>();
  pagination: PaginationState = {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  };

  constructor(
    private readonly workOrderService: WorkOrderService,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$),
    ).subscribe(() => this.loadWorkOrders(1));

    this.loadWorkOrders();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get hasWorkOrders(): boolean {
    return this.workOrders.length > 0;
  }

  loadWorkOrders(page = this.pagination.page): void {
    this.loading = true;
    this.errorMessage = '';

    const query: MasterDataListQuery = {
      search: this.searchTerm || undefined,
      status: this.statusFilter || undefined,
      paymentStatus: this.paymentStatusFilter || undefined,
      dateFrom: this.dateFrom || undefined,
      dateTo: this.dateTo || undefined,
      page,
      pageSize: this.pagination.pageSize,
    };

    this.workOrderService.listWorkOrders(query)
      .pipe(finalize(() => {
        this.loading = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.workOrders = Array.isArray(response?.data) ? response.data : [];

          if (response?.pagination) {
            this.pagination = response.pagination;
          }

          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          this.workOrders = [];
          this.errorMessage = error?.error?.message || 'Failed to load work orders.';
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  onSearchInput(): void {
    this.searchSubject.next(this.searchTerm);
  }

  onStatusChange(): void {
    this.loadWorkOrders(1);
  }

  applyDateFilter(): void {
    if (this.hasDateRangeError) {
      return;
    }
    this.loadWorkOrders(1);
  }

  get dateRangeError(): string {
    return getDateRangeError(this.dateFrom, this.dateTo);
  }

  get hasDateRangeError(): boolean {
    return Boolean(this.dateRangeError);
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.loadWorkOrders(1);
  }

  clearDates(): void {
    this.dateFrom = '';
    this.dateTo = '';
    this.loadWorkOrders(1);
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.statusFilter = '';
    this.paymentStatusFilter = '';
    this.dateFrom = '';
    this.dateTo = '';
    this.loadWorkOrders(1);
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.pagination.totalPages || page === this.pagination.page) {
      return;
    }

    this.loadWorkOrders(page);
  }

  getRowNumber(index: number): number {
    return ((this.pagination.page - 1) * this.pagination.pageSize) + index + 1;
  }

  getWorkOrderNumber(workOrder: MasterDataWorkOrder): string {
    return workOrder.workOrderNumber || workOrder.workOrderId || workOrder.orderReferenceNumber || '-';
  }

  openDetails(workOrder: MasterDataWorkOrder): void {
    const workOrderNumber = this.getWorkOrderNumber(workOrder);
    if (workOrderNumber === '-') {
      return;
    }

    this.selectedWorkOrder = workOrder;
    this.workOrderDetails = null;
    this.detailsError = '';
    this.detailsLoading = true;
    this.workOrderService.getWorkOrderDetails(workOrderNumber)
      .pipe(finalize(() => {
        this.detailsLoading = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.workOrderDetails = response?.data || null;
          this.detailsError = this.workOrderDetails ? '' : 'Work order details are not available.';
        },
        error: (error) => {
          this.detailsError = error?.error?.message || 'Unable to load work order details.';
        },
      });
  }

  closeDetails(): void {
    this.selectedWorkOrder = null;
    this.workOrderDetails = null;
    this.detailsError = '';
    this.detailsLoading = false;
  }

  getRequestedAt(workOrder: MasterDataWorkOrder): string | null {
    return workOrder.requestedAt || workOrder.createdAt || null;
  }

  getCustomerName(workOrder: MasterDataWorkOrder): string {
    return (
      workOrder.customerDisplayName ||
      workOrder.customerInfo?.name ||
      workOrder.customerInfo?.emailId ||
      workOrder.customerId ||
      '-'
    );
  }

  getCustomerCode(workOrder: MasterDataWorkOrder): string {
    return workOrder.customerCode || workOrder.customerInfo?.phNumber || 'No customer code';
  }

  getTotalAmount(workOrder: MasterDataWorkOrder): number {
    return Number(workOrder.totalAmount ?? workOrder.grandTotal ?? 0);
  }

  getBalanceAmount(workOrder: MasterDataWorkOrder): number {
    if (workOrder.balanceAmount != null) {
      return Number(workOrder.balanceAmount);
    }

    return this.getTotalAmount(workOrder);
  }

  getDeliveryMode(workOrder: MasterDataWorkOrder): string {
    return workOrder.deliveryMode || workOrder.fulfillmentMode || 'n/a';
  }

  getTaskSummaryLabel(workOrder: MasterDataWorkOrder): string {
    const fallbackTaskCount = Array.isArray(workOrder.items) ? workOrder.items.length : 0;
    const totalTasks = Number(workOrder.taskSummary?.totalTasks ?? fallbackTaskCount);
    const pendingTasks = Number(workOrder.taskSummary?.pendingTasks ?? fallbackTaskCount);
    const inProgressTasks = Number(workOrder.taskSummary?.inProgressTasks ?? 0);
    const completedTasks = Number(workOrder.taskSummary?.completedTasks ?? 0);

    return `${totalTasks} total · ${pendingTasks} pending · ${inProgressTasks} active · ${completedTasks} done`;
  }
}

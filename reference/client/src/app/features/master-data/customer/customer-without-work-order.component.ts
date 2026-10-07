import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { MasterDataCustomer, PaginationState } from '../shared/master-data.types';
import { CustomerService } from './customer.service';

@Component({
  selector: 'app-customer-without-work-order',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './customer-without-work-order.component.html',
  styleUrl: './customer-without-work-order.component.css',
})
export class CustomerWithoutWorkOrderComponent implements OnInit {
  customers: MasterDataCustomer[] = [];
  loading = false;
  errorMessage = '';
  searchTerm = '';
  statusFilter = '';
  pagination: PaginationState = {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  };

  constructor(
    private readonly customerService: CustomerService,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadCustomers();
  }

  get hasCustomers(): boolean {
    return this.customers.length > 0;
  }

  loadCustomers(page = this.pagination.page): void {
    this.loading = true;
    this.errorMessage = '';

    this.customerService.listCustomersWithoutWorkOrders({
      search: this.searchTerm || undefined,
      status: this.statusFilter || undefined,
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
        },
        error: (error) => {
          this.customers = [];
          this.errorMessage = error?.error?.message || 'Failed to load customers without work orders.';
        },
      });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.pagination.totalPages || page === this.pagination.page) {
      return;
    }

    this.loadCustomers(page);
  }

  getRowNumber(index: number): number {
    return ((this.pagination.page - 1) * this.pagination.pageSize) + index + 1;
  }
}

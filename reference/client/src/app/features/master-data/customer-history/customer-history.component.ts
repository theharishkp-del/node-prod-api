import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { finalize } from 'rxjs';
import { CustomerHistoryService } from './customer-history.service';
import {
  CustomerHistoryContext,
  CustomerHistoryOrderRecord,
  CustomerHistoryResponse,
} from '../shared/master-data.types';
import { decodeCustomerHistoryContext } from '../../../utils/decode-customer-history-context.util';

@Component({
  selector: 'app-customer-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './customer-history.component.html',
  styleUrl: './customer-history.component.css',
})
export class CustomerHistoryComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly customerHistoryService = inject(CustomerHistoryService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  protected encodedCustomerContext = '';
  protected customerContext: CustomerHistoryContext | null = null;
  protected customerHistory: CustomerHistoryResponse | null = null;
  protected historyItems: CustomerHistoryOrderRecord[] = [];
  protected errorMessage = '';
  protected loading = true;
  protected expandedOrderKeys = new Set<string>();

  ngOnInit(): void {
    const encodedCustomerContext = String(this.route.snapshot.queryParamMap.get('customer') || '').trim();

    console.log('[CustomerHistoryComponent] Init', {
      currentUrl: typeof window !== 'undefined' ? window.location.href : '',
      encodedCustomerContext,
    });

    if (!encodedCustomerContext) {
      console.warn('[CustomerHistoryComponent] Missing customer query param');
      this.errorMessage = 'Customer history link is missing customer details.';
      this.loading = false;
      this.changeDetectorRef.detectChanges();
      return;
    }

    this.encodedCustomerContext = encodedCustomerContext;

    try {
      this.customerContext = decodeCustomerHistoryContext(encodedCustomerContext);
      console.log('[CustomerHistoryComponent] Decoded customer context', this.customerContext);
    } catch (error) {
      console.error('[CustomerHistoryComponent] Failed to decode customer context', error);
      this.errorMessage = (error as Error).message;
      this.loading = false;
      this.changeDetectorRef.detectChanges();
      return;
    }

    this.customerHistoryService.getCustomerHistory(encodedCustomerContext)
      .pipe(finalize(() => {
        console.log('[CustomerHistoryComponent] Request finalize', {
          loadingBeforeFinalize: this.loading,
          historyCount: this.historyItems.length,
          errorMessage: this.errorMessage,
        });
        this.loading = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          console.log('[CustomerHistoryComponent] Subscribe next', response);
          this.customerHistory = response?.data || null;
          this.historyItems = Array.isArray(response?.data?.history) ? response.data.history : [];
          this.expandedOrderKeys = new Set(
            this.historyItems.length ? [this.trackByOrderReference(0, this.historyItems[0])] : [],
          );
          console.log('[CustomerHistoryComponent] History items set', {
            historyCount: this.historyItems.length,
            customer: this.customerHistory?.customer,
          });
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          console.error('[CustomerHistoryComponent] Subscribe error', error);
          this.errorMessage = String(error?.error?.message || error?.message || 'Unable to load customer history.');
          this.changeDetectorRef.detectChanges();
        },
      });
  }

  protected trackByOrderReference(_index: number, item: CustomerHistoryOrderRecord): string {
    return `${item.orderReferenceNumber || 'order'}_${item.latestActivityAt || item.requestedAt || _index}`;
  }

  protected getVisibleCustomerName(): string {
    return this.customerHistory?.customer?.displayName || this.customerContext?.displayName || 'Customer';
  }

  protected isExpanded(index: number, item: CustomerHistoryOrderRecord): boolean {
    return this.expandedOrderKeys.has(this.trackByOrderReference(index, item));
  }

  protected toggleExpanded(index: number, item: CustomerHistoryOrderRecord): void {
    const key = this.trackByOrderReference(index, item);

    if (this.expandedOrderKeys.has(key)) {
      this.expandedOrderKeys.delete(key);
    } else {
      this.expandedOrderKeys.add(key);
    }

    this.expandedOrderKeys = new Set(this.expandedOrderKeys);
    this.changeDetectorRef.detectChanges();
  }
}

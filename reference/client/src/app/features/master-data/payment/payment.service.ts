import { Injectable } from '@angular/core';
import { MasterDataApiBaseService } from '../shared/master-data-api-base.service';
import { MasterDataListQuery, MasterDataPayment, PaymentZohoSyncSummary } from '../shared/master-data.types';

@Injectable({ providedIn: 'root' })
export class PaymentService extends MasterDataApiBaseService {
  listPayments(query: MasterDataListQuery = {}) {
    return this.getList<MasterDataPayment>('payments', query);
  }

  getPayment(id: string) {
    return this.getItem<MasterDataPayment>('payments', id);
  }

  createPayment(payload: Partial<MasterDataPayment>) {
    return this.createItem<MasterDataPayment>('payments', payload);
  }

  updatePayment(id: string, payload: Partial<MasterDataPayment>) {
    return this.updateItem<MasterDataPayment>('payments', id, payload);
  }

  deletePayment(id: string) {
    return this.deleteItem('payments', id);
  }

  syncPaymentToZoho(id: string) {
    return this.createItem<MasterDataPayment>(`payments/${id}/sync`, {});
  }

  syncAllPaymentsToZoho() {
    return this.createItem<{
      totalPayments: number;
      syncedCount: number;
      failedCount: number;
      failures: Array<{ paymentId: string; paymentNumber: string; errorMessage: string }>;
    }>('payments/sync', {});
  }

  getPaymentZohoSyncSummary() {
    return this.getResource<PaymentZohoSyncSummary>('payments/sync-summary');
  }
}

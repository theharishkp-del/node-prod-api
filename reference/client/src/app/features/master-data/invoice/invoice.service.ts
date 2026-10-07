import { Injectable } from '@angular/core';
import { MasterDataApiBaseService } from '../shared/master-data-api-base.service';
import { InvoiceZohoSyncSummary, MasterDataInvoice, MasterDataListQuery } from '../shared/master-data.types';

@Injectable({ providedIn: 'root' })
export class InvoiceService extends MasterDataApiBaseService {
  listInvoices(query: MasterDataListQuery = {}) {
    return this.getList<MasterDataInvoice>('invoices', query);
  }

  getInvoice(id: string) {
    return this.getItem<MasterDataInvoice>('invoices', id);
  }

  createInvoice(payload: Partial<MasterDataInvoice>) {
    return this.createItem<MasterDataInvoice>('invoices', payload);
  }

  updateInvoice(id: string, payload: Partial<MasterDataInvoice>) {
    return this.updateItem<MasterDataInvoice>('invoices', id, payload);
  }

  deleteInvoice(id: string) {
    return this.deleteItem('invoices', id);
  }

  syncInvoiceToZoho(id: string) {
    return this.createItem<MasterDataInvoice>(`invoices/${id}/sync`, {});
  }

  syncAllInvoicesToZoho() {
    return this.createItem<{
      totalInvoices: number;
      syncedCount: number;
      failedCount: number;
      failures: Array<{ invoiceId: string; invoiceNumber: string; errorMessage: string }>;
    }>('invoices/sync', {});
  }

  getInvoiceZohoSyncSummary() {
    return this.getResource<InvoiceZohoSyncSummary>('invoices/sync-summary');
  }

  getInvoicePdf(id: string) {
    return this.getBlob(`invoices/${id}/pdf`);
  }
}

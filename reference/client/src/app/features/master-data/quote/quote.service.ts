import { Injectable } from '@angular/core';
import { MasterDataApiBaseService } from '../shared/master-data-api-base.service';
import { MasterDataListQuery, MasterDataQuote, QuoteZohoSyncSummary } from '../shared/master-data.types';

@Injectable({ providedIn: 'root' })
export class QuoteService extends MasterDataApiBaseService {
  listQuotes(query: MasterDataListQuery = {}) {
    return this.getList<MasterDataQuote>('quotes', query);
  }

  getQuote(id: string) {
    return this.getItem<MasterDataQuote>('quotes', id);
  }

  createQuote(payload: Partial<MasterDataQuote>) {
    return this.createItem<MasterDataQuote>('quotes', payload);
  }

  updateQuote(id: string, payload: Partial<MasterDataQuote>) {
    return this.updateItem<MasterDataQuote>('quotes', id, payload);
  }

  deleteQuote(id: string) {
    return this.deleteItem('quotes', id);
  }

  syncQuoteToZoho(id: string) {
    return this.createItem<MasterDataQuote>(`quotes/${id}/sync`, {});
  }

  syncAllQuotesToZoho() {
    return this.createItem<{
      totalQuotes: number;
      syncedCount: number;
      failedCount: number;
      failures: Array<{ quoteId: string; quoteNumber: string; errorMessage: string }>;
    }>('quotes/sync', {});
  }

  getQuoteZohoSyncSummary() {
    return this.getResource<QuoteZohoSyncSummary>('quotes/sync-summary');
  }

  getQuotePdf(id: string) {
    return this.getBlob(`quotes/${id}/pdf`);
  }
}

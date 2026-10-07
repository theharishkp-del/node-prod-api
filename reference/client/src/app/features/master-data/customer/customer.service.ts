import { Injectable } from '@angular/core';
import { MasterDataApiBaseService } from '../shared/master-data-api-base.service';
import { CustomerZohoSyncSummary, MasterDataCustomer, MasterDataListQuery } from '../shared/master-data.types';

@Injectable({ providedIn: 'root' })
export class CustomerService extends MasterDataApiBaseService {
  listCustomers(query: MasterDataListQuery = {}) {
    return this.getList<MasterDataCustomer>('customers', query);
  }

  listCustomersWithoutWorkOrders(query: MasterDataListQuery = {}) {
    return this.getList<MasterDataCustomer>('customers/without-work-orders', query);
  }

  getCustomer(id: string) {
    return this.getItem<MasterDataCustomer>('customers', id);
  }

  createCustomer(payload: Partial<MasterDataCustomer>) {
    return this.createItem<MasterDataCustomer>('customers', payload);
  }

  updateCustomer(id: string, payload: Partial<MasterDataCustomer>) {
    return this.updateItem<MasterDataCustomer>('customers', id, payload);
  }

  deleteCustomer(id: string) {
    return this.deleteItem('customers', id);
  }

  syncCustomerToZoho(id: string) {
    return this.createItem<MasterDataCustomer>(`customers/${id}/sync`, {});
  }

  syncAllCustomersToZoho() {
    return this.createItem<{
      totalCustomers: number;
      syncedCount: number;
      failedCount: number;
      failures: Array<{ customerId: string; displayName: string; errorMessage: string }>;
    }>('customers/sync', {});
  }

  getCustomerZohoSyncSummary() {
    return this.getResource<CustomerZohoSyncSummary>('customers/sync-summary');
  }
}

import { Injectable } from '@angular/core';
import { MasterDataApiBaseService } from './shared/master-data-api-base.service';
import {
  MasterDataApiResponse,
  MasterDataCustomer,
  MasterDataInvoice,
  MasterDataWorkOrder,
  ReportDownloadQuery,
} from './shared/master-data.types';

@Injectable({ providedIn: 'root' })
export class ReportsService extends MasterDataApiBaseService {
  previewCustomerReport(query: ReportDownloadQuery = {}) {
    return this.http.get<MasterDataApiResponse<MasterDataCustomer[]>>(`${this.baseUrl}/reports/customers`, {
      headers: this.buildHeaders(),
      params: this.buildDownloadParams(query),
      context: this.buildContext(),
    });
  }

  previewInvoiceReport(query: ReportDownloadQuery = {}) {
    return this.http.get<MasterDataApiResponse<MasterDataInvoice[]>>(`${this.baseUrl}/reports/invoices`, {
      headers: this.buildHeaders(),
      params: this.buildDownloadParams(query),
      context: this.buildContext(),
    });
  }

  previewWorkOrderReport(query: ReportDownloadQuery = {}) {
    return this.http.get<MasterDataApiResponse<MasterDataWorkOrder[]>>(`${this.baseUrl}/reports/work-orders`, {
      headers: this.buildHeaders(),
      params: this.buildDownloadParams(query),
      context: this.buildContext(),
    });
  }

  downloadCustomerReport(query: ReportDownloadQuery = {}) {
    return this.getBlobWithQuery('reports/customers/download', query);
  }

  downloadInvoiceReport(query: ReportDownloadQuery = {}) {
    return this.getBlobWithQuery('reports/invoices/download', query);
  }

  downloadWorkOrderReport(query: ReportDownloadQuery = {}) {
    return this.getBlobWithQuery('reports/work-orders/download', query);
  }
}

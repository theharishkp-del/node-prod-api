import { Injectable } from '@angular/core';
import { MasterDataApiBaseService } from '../shared/master-data-api-base.service';
import {
  BusinessDashboardSummary,
  AdminCalendarWorkOrderDetails,
  DashboardSummaryQuery,
  MasterDataListQuery,
  MasterDataWorkOrder,
} from '../shared/master-data.types';

@Injectable({ providedIn: 'root' })
export class WorkOrderService extends MasterDataApiBaseService {
  listWorkOrders(query: MasterDataListQuery = {}) {
    return this.getList<MasterDataWorkOrder>('work-orders', query);
  }

  getWorkOrderDetails(workOrderNumber: string) {
    return this.getResource<AdminCalendarWorkOrderDetails>(
      `work-orders/${encodeURIComponent(workOrderNumber)}/details`
    );
  }

  getBusinessDashboardSummary(query: DashboardSummaryQuery = {}) {
    return this.getResourceWithQuery<BusinessDashboardSummary>('dashboard/summary', query);
  }
}

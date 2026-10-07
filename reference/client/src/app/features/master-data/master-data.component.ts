import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { CustomerListComponent } from './customer/customer-list.component';
import { InvoiceListComponent } from './invoice/invoice-list.component';
import { PaymentListComponent } from './payment/payment-list.component';
import { QuoteListComponent } from './quote/quote-list.component';
import { SyncDashboardComponent } from './sync-dashboard.component';
import { TierListComponent } from './tier/tier-list.component';
import { WorkOrderListComponent } from './work-order/work-order-list.component';

type MasterDataTab =
  | 'sync'
  | 'settings'
  | 'tier'
  | 'work-order'
  | 'customer'
  | 'quote'
  | 'invoice'
  | 'payment';

@Component({
  selector: 'app-master-data',
  standalone: true,
  imports: [
    CommonModule,
    CustomerListComponent,
    QuoteListComponent,
    InvoiceListComponent,
    PaymentListComponent,
    SyncDashboardComponent,
    TierListComponent,
    WorkOrderListComponent,
  ],
  templateUrl: './master-data.component.html',
  styleUrl: './master-data.component.css',
})
export class MasterDataComponent {
  readonly activeTab = signal<MasterDataTab>('sync');

  readonly tabs: Array<{ key: MasterDataTab; label: string; tone: 'neutral' | 'work-order' | 'sales'; }> = [
    { key: 'sync', label: 'Zoho Sync', tone: 'neutral' },
    { key: 'settings', label: 'Settings', tone: 'neutral' },
    { key: 'tier', label: 'Tier Master', tone: 'neutral' },
    { key: 'work-order', label: 'Work Order', tone: 'work-order' },
    { key: 'customer', label: 'Customer', tone: 'sales' },
    { key: 'quote', label: 'Quote', tone: 'sales' },
    { key: 'invoice', label: 'Invoice', tone: 'sales' },
    { key: 'payment', label: 'Payment', tone: 'sales' },
  ];

  getTabClass(tab: { key: MasterDataTab; tone: 'neutral' | 'work-order' | 'sales'; }): string {
    const isActive = this.activeTab() === tab.key;
    const toneClassMap = {
      neutral: isActive ? 'master-tab-card-active-neutral' : 'master-tab-card-neutral',
      'work-order': isActive ? 'master-tab-card-active-work-order' : 'master-tab-card-work-order',
      sales: isActive ? 'master-tab-card-active-sales' : 'master-tab-card-sales',
    };

    return `master-tab-card ${toneClassMap[tab.tone]}`;
  }

  setActiveTab(tab: MasterDataTab): void {
    this.activeTab.set(tab);
  }
}

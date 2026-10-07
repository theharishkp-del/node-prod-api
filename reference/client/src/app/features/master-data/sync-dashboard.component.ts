import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, Input, OnInit } from '@angular/core';
import { finalize, forkJoin, firstValueFrom } from 'rxjs';
import { BotMasterKeyService } from '../../services/bot-master-key.service';
import { ZohoApiService } from '../../services/zoho-api.service';
import { CustomerService } from './customer/customer.service';
import { InvoiceService } from './invoice/invoice.service';
import { PaymentService } from './payment/payment.service';
import { QuoteService } from './quote/quote.service';

type SyncModuleKey = 'customer' | 'quote' | 'invoice' | 'payment';

interface SyncModuleCard {
  key: SyncModuleKey;
  label: string;
  description: string;
  total: number;
  synced: number;
  pending: number;
  failed: number;
  lastOverallSyncedAt: string | null;
}

interface SyncExecutionResult {
  data?: Record<string, unknown>;
}

@Component({
  selector: 'app-sync-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sync-dashboard.component.html',
  styleUrl: './sync-dashboard.component.css',
})
export class SyncDashboardComponent implements OnInit {
  @Input() viewMode: 'sync' | 'settings' = 'sync';
  loading = false;
  syncingAll = false;
  syncingModuleKey: SyncModuleKey | '' = '';
  successMessage = '';
  errorMessage = '';
  zohoConnected = false;
  zohoConnectionLoading = false;
  autoSyncEnabled = true;
  autoSyncSaving = false;
  zohoStatusMessage = 'Zoho is not connected.';

  readonly cards: SyncModuleCard[] = [
    {
      key: 'customer',
      label: 'Customers',
      description: 'Base records that must sync first.',
      total: 0,
      synced: 0,
      pending: 0,
      failed: 0,
      lastOverallSyncedAt: null,
    },
    {
      key: 'quote',
      label: 'Quotes',
      description: 'Depends on synced Zoho customers.',
      total: 0,
      synced: 0,
      pending: 0,
      failed: 0,
      lastOverallSyncedAt: null,
    },
    {
      key: 'invoice',
      label: 'Invoices',
      description: 'Sync after customers and quotes.',
      total: 0,
      synced: 0,
      pending: 0,
      failed: 0,
      lastOverallSyncedAt: null,
    },
    {
      key: 'payment',
      label: 'Payments',
      description: 'Sync only after invoices are available in Zoho.',
      total: 0,
      synced: 0,
      pending: 0,
      failed: 0,
      lastOverallSyncedAt: null,
    },
  ];

  constructor(
    private readonly botMasterKeyService: BotMasterKeyService,
    private readonly zohoApiService: ZohoApiService,
    private readonly customerService: CustomerService,
    private readonly quoteService: QuoteService,
    private readonly invoiceService: InvoiceService,
    private readonly paymentService: PaymentService,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadZohoConnectionStatus();
    this.loadSummaries();
  }

  get totalRecords(): number {
    return this.cards.reduce((sum, card) => sum + card.total, 0);
  }

  get totalSynced(): number {
    return this.cards.reduce((sum, card) => sum + card.synced, 0);
  }

  get totalPending(): number {
    return this.cards.reduce((sum, card) => sum + card.pending, 0);
  }

  get totalFailed(): number {
    return this.cards.reduce((sum, card) => sum + card.failed, 0);
  }

  get syncDisabledReason(): string {
    if (this.zohoConnectionLoading) {
      return 'Checking Zoho connection...';
    }

    if (!this.zohoConnected) {
      return this.zohoStatusMessage || 'Zoho is not connected.';
    }

    return '';
  }

  get canRunZohoSync(): boolean {
    return this.zohoConnected && !this.zohoConnectionLoading;
  }

  get canToggleAutoSync(): boolean {
    return this.zohoConnected && !this.zohoConnectionLoading && !this.autoSyncSaving;
  }

  get isSettingsView(): boolean {
    return this.viewMode === 'settings';
  }

  get isSyncView(): boolean {
    return this.viewMode === 'sync';
  }

  get autoSyncHint(): string {
    if (this.zohoConnectionLoading) {
      return 'Checking Zoho connection...';
    }

    if (!this.zohoConnected) {
      return 'Connect Zoho Books to enable automatic sync on create.';
    }

    return this.autoSyncEnabled
      ? 'Automatic sync is active for customer, quote, invoice, and payment creation.'
      : 'Records will stay in Mongo until you run manual Zoho sync.';
  }

  loadSummaries(): void {
    this.loading = true;
    this.errorMessage = '';

    forkJoin({
      customer: this.customerService.getCustomerZohoSyncSummary(),
      quote: this.quoteService.getQuoteZohoSyncSummary(),
      invoice: this.invoiceService.getInvoiceZohoSyncSummary(),
      payment: this.paymentService.getPaymentZohoSyncSummary(),
    })
      .pipe(finalize(() => {
        this.loading = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.updateCard('customer', {
            total: response.customer?.data?.totalCustomers ?? 0,
            synced: response.customer?.data?.syncedCount ?? 0,
            pending: response.customer?.data?.pendingCount ?? 0,
            failed: response.customer?.data?.failedCount ?? 0,
            lastOverallSyncedAt: response.customer?.data?.lastOverallSyncedAt ?? null,
          });
          this.updateCard('quote', {
            total: response.quote?.data?.totalQuotes ?? 0,
            synced: response.quote?.data?.syncedCount ?? 0,
            pending: response.quote?.data?.pendingCount ?? 0,
            failed: response.quote?.data?.failedCount ?? 0,
            lastOverallSyncedAt: response.quote?.data?.lastOverallSyncedAt ?? null,
          });
          this.updateCard('invoice', {
            total: response.invoice?.data?.totalInvoices ?? 0,
            synced: response.invoice?.data?.syncedCount ?? 0,
            pending: response.invoice?.data?.pendingCount ?? 0,
            failed: response.invoice?.data?.failedCount ?? 0,
            lastOverallSyncedAt: response.invoice?.data?.lastOverallSyncedAt ?? null,
          });
          this.updateCard('payment', {
            total: response.payment?.data?.totalPayments ?? 0,
            synced: response.payment?.data?.syncedCount ?? 0,
            pending: response.payment?.data?.pendingCount ?? 0,
            failed: response.payment?.data?.failedCount ?? 0,
            lastOverallSyncedAt: response.payment?.data?.lastOverallSyncedAt ?? null,
          });
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Failed to load sync dashboard.';
        },
      });
  }

  async syncModule(key: SyncModuleKey): Promise<void> {
    if (!this.canRunZohoSync || this.syncingAll || this.syncingModuleKey === key) {
      return;
    }

    this.syncingModuleKey = key;
    this.successMessage = '';
    this.errorMessage = '';

    try {
      const result = await this.executeModuleSync(key);
      this.assertModuleSyncSucceeded(key, result);
      this.successMessage = this.buildModuleSuccessMessage(key, result?.data);
      this.loadSummaries();
    } catch (error) {
      const syncError = error as { error?: { message?: string } };
      this.errorMessage = syncError?.error?.message || `Failed to sync ${this.getModuleLabel(key).toLowerCase()}.`;
      this.changeDetectorRef.detectChanges();
    } finally {
      this.syncingModuleKey = '';
      this.changeDetectorRef.detectChanges();
    }
  }

  async syncAll(): Promise<void> {
    if (!this.canRunZohoSync || this.syncingAll || this.syncingModuleKey) {
      return;
    }

    this.syncingAll = true;
    this.successMessage = '';
    this.errorMessage = '';

    const order: SyncModuleKey[] = ['customer', 'quote', 'invoice', 'payment'];
    const summaryParts: string[] = [];

    try {
      for (const key of order) {
        const result = await this.executeModuleSync(key);
        this.assertModuleSyncSucceeded(key, result);
        summaryParts.push(this.buildModuleShortSummary(key, result?.data));
      }

      this.successMessage = `Master sync completed. ${summaryParts.join(' | ')}`;
      this.loadSummaries();
    } catch (error) {
      const syncError = error as { error?: { message?: string } };
      this.errorMessage = syncError?.error?.message || 'Master sync failed.';
      this.changeDetectorRef.detectChanges();
    } finally {
      this.syncingAll = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  toggleAutoSync(): void {
    const botMasterKey = this.botMasterKeyService.botMasterKey();

    if (!botMasterKey || !this.canToggleAutoSync) {
      return;
    }

    const nextValue = !this.autoSyncEnabled;
    this.autoSyncSaving = true;
    this.successMessage = '';
    this.errorMessage = '';

    this.zohoApiService.updateZohoAutoSync(botMasterKey, nextValue)
      .pipe(finalize(() => {
        this.autoSyncSaving = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.autoSyncEnabled = response?.autoSyncEnabled !== false;
          this.successMessage = response?.message || `Zoho auto sync ${this.autoSyncEnabled ? 'enabled' : 'disabled'} successfully.`;
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Failed to update Zoho auto sync setting.';
        },
      });
  }

  getCardStatusClass(card: SyncModuleCard): string {
    if (card.failed > 0) {
      return 'sync-status-badge sync-status-failed';
    }

    if (card.pending > 0) {
      return 'sync-status-badge sync-status-pending';
    }

    return 'sync-status-badge sync-status-synced';
  }

  getCardStatusLabel(card: SyncModuleCard): string {
    if (card.failed > 0) {
      return 'Needs Attention';
    }

    if (card.pending > 0) {
      return 'Pending';
    }

    return 'Synced';
  }

  private loadZohoConnectionStatus(): void {
    const botMasterKey = this.botMasterKeyService.botMasterKey();

    if (!botMasterKey) {
      this.zohoConnected = false;
      this.zohoStatusMessage = 'Zoho is not connected.';
      return;
    }

    this.zohoConnectionLoading = true;

    this.zohoApiService.getZohoStatus(botMasterKey)
      .pipe(finalize(() => {
        this.zohoConnectionLoading = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.zohoConnected = !!response?.connected;
          this.autoSyncEnabled = !!response?.autoSyncEnabled;

          if (this.zohoConnected) {
            const organizationName = String(
              response?.selectedOrganizationName ||
              response?.organizationName ||
              ''
            ).trim();
            this.zohoStatusMessage = organizationName
              ? `Connected to Zoho Books: ${organizationName}.`
              : 'Connected to Zoho Books.';
            return;
          }

          this.zohoStatusMessage = 'Zoho is not connected. Please connect Zoho Books to enable sync.';
        },
        error: () => {
          this.zohoConnected = false;
          this.autoSyncEnabled = true;
          this.zohoStatusMessage = 'Unable to verify Zoho connection. Please reconnect Zoho Books.';
        },
      });
  }

  private updateCard(
    key: SyncModuleKey,
    values: Pick<SyncModuleCard, 'total' | 'synced' | 'pending' | 'failed' | 'lastOverallSyncedAt'>,
  ): void {
    const card = this.cards.find((item) => item.key === key);
    if (!card) {
      return;
    }

    card.total = values.total;
    card.synced = values.synced;
    card.pending = values.pending;
    card.failed = values.failed;
    card.lastOverallSyncedAt = values.lastOverallSyncedAt;
  }

  private executeModuleSync(key: SyncModuleKey): Promise<SyncExecutionResult> {
    switch (key) {
      case 'customer':
        return firstValueFrom(this.customerService.syncAllCustomersToZoho());
      case 'quote':
        return firstValueFrom(this.quoteService.syncAllQuotesToZoho());
      case 'invoice':
        return firstValueFrom(this.invoiceService.syncAllInvoicesToZoho());
      case 'payment':
        return firstValueFrom(this.paymentService.syncAllPaymentsToZoho());
      default:
        throw new Error('Unsupported sync module.');
    }
  }

  private getModuleLabel(key: SyncModuleKey): string {
    return this.cards.find((card) => card.key === key)?.label || key;
  }

  private buildModuleSuccessMessage(key: SyncModuleKey, data: Record<string, unknown> | undefined): string {
    return `${this.getModuleLabel(key)} sync completed. ${this.buildModuleShortSummary(key, data)}`;
  }

  private buildModuleShortSummary(key: SyncModuleKey, data: Record<string, unknown> | undefined): string {
    const configMap: Record<SyncModuleKey, { total: string; synced: string }> = {
      customer: { total: 'totalCustomers', synced: 'syncedCount' },
      quote: { total: 'totalQuotes', synced: 'syncedCount' },
      invoice: { total: 'totalInvoices', synced: 'syncedCount' },
      payment: { total: 'totalPayments', synced: 'syncedCount' },
    };

    const config = configMap[key];
    const total = Number(data?.[config.total] ?? 0);
    const synced = Number(data?.[config.synced] ?? 0);
    return `${this.getModuleLabel(key)} ${synced}/${total}`;
  }

  private assertModuleSyncSucceeded(key: SyncModuleKey, result: SyncExecutionResult): void {
    const failedCount = Number(result?.data?.['failedCount'] ?? 0);

    if (failedCount <= 0) {
      return;
    }

    const moduleLabel = this.getModuleLabel(key);
    const failures = Array.isArray(result?.data?.['failures']) ? result.data['failures'] : [];
    const firstFailure = failures[0] as { errorMessage?: string } | undefined;
    const failureMessage = String(firstFailure?.errorMessage || `${moduleLabel} sync has failed records.`).trim();

    throw {
      error: {
        message: `${moduleLabel} sync stopped with ${failedCount} failed record${failedCount > 1 ? 's' : ''}. ${failureMessage}`,
      },
    };
  }
}

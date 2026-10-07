import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { finalize } from 'rxjs';
import { BotMasterKeyService } from '../services/bot-master-key.service';
import { ZohoApiService } from '../services/zoho-api.service';
import {
  ZohoAccessibleOrganization,
  ZohoInitialImportState,
  ZohoIntegrationStatusResponse,
  ZohoOrganizationSelectionResponse,
} from '../models/onboarding.models';

const ZOHO_SELECTION_REQUIRED_MESSAGE = 'Zoho Books connected. Choose one organization for this FSM Agent bot.';
const ZOHO_SUCCESS_MESSAGE = 'Zoho Books connected successfully.';

@Component({
  selector: 'app-zoho-callback',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './zoho-callback.html',
  styleUrl: './zoho-callback.css',
})
export class ZohoCallback implements OnInit, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);
  private readonly route = inject(ActivatedRoute);
  private readonly botMasterKeyService = inject(BotMasterKeyService);
  private readonly zohoApi = inject(ZohoApiService);

  protected status: 'success' | 'error' | 'selection_required' | 'importing' = 'success';
  protected message = ZOHO_SUCCESS_MESSAGE;
  protected organizationName = '';
  protected closeBlockedMessage = '';
  protected statusLoading = false;
  protected statusError = '';
  protected selectingOrganization = false;
  protected selectionMessage = '';
  protected selectedOrganizationId = '';
  protected accessibleOrganizations: ZohoAccessibleOrganization[] = [];
  protected selectionRequired = false;
  protected organizationLocked = false;
  protected statusLoaded = false;
  protected initialImport: ZohoInitialImportState | null = null;
  private importPollTimer: ReturnType<typeof window.setTimeout> | null = null;
  private loadStarted = false;

  ngOnInit(): void {
    const status = this.route.snapshot.queryParamMap.get('status');
    const message = this.route.snapshot.queryParamMap.get('message');
    const organizationName = this.route.snapshot.queryParamMap.get('organization_name');

    this.status = status === 'error' ? 'error' : (status === 'selection_required' ? 'selection_required' : 'success');
    this.message = this.status === 'selection_required'
      ? ZOHO_SELECTION_REQUIRED_MESSAGE
      : (message?.trim() || (this.status === 'error'
        ? 'Zoho Books connection failed.'
        : ZOHO_SUCCESS_MESSAGE));
    this.organizationName = organizationName?.trim() || '';

    if (this.status !== 'error') {
      this.statusLoading = true;
      window.setTimeout(() => {
        if (!this.loadStarted) {
          this.ngZone.run(() => {
            this.loadStarted = true;
            this.loadZohoStatus();
          });
        }
      }, 0);
    }
  }

  protected backToBot(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.closeBlockedMessage = '';

    if (window.opener && !window.opener.closed) {
      window.opener.focus();
    }

    window.close();

    window.setTimeout(() => {
      if (!window.closed) {
        this.closeBlockedMessage = 'Your browser blocked automatic closing. Please close this tab manually.';
      }
    }, 250);
  }

  ngOnDestroy(): void {
    this.clearImportPollTimer();
  }

  protected saveOrganizationSelection(): void {
    const botMasterKey = this.botMasterKeyService.botMasterKey();

    if (!botMasterKey || !this.selectedOrganizationId || this.selectingOrganization || this.organizationLocked) {
      return;
    }

    this.selectingOrganization = true;
    this.statusError = '';
    this.selectionMessage = '';

    this.zohoApi.selectZohoOrganization(botMasterKey, this.selectedOrganizationId)
      .pipe(finalize(() => {
        this.selectingOrganization = false;
        this.cdr.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.applyOrganizationSelection(response);
        },
        error: (error) => {
          this.statusError = error?.error?.message || 'Failed to save the selected Zoho Books organization.';
          this.cdr.detectChanges();
        },
      });
  }

  private loadZohoStatus(): void {
    const botMasterKey = this.botMasterKeyService.botMasterKey();

    if (!botMasterKey) {
      this.statusError = 'Bot context is missing for this Zoho callback.';
      this.cdr.detectChanges();
      return;
    }

    this.statusLoading = true;
    this.statusLoaded = false;
    this.statusError = '';

    this.zohoApi.getZohoStatus(botMasterKey)
      .pipe(finalize(() => {
        this.statusLoading = false;
        this.cdr.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.statusLoaded = true;
          this.applyZohoStatus(response);
        },
        error: (error) => {
          this.statusLoaded = true;
          this.statusError = error?.error?.message || 'Failed to load Zoho Books organization status.';
          this.cdr.detectChanges();
        },
      });
  }

  private applyZohoStatus(response: ZohoIntegrationStatusResponse): void {
    this.accessibleOrganizations = response.accessibleOrganizations || [];
    this.selectionRequired = Boolean(response.selectionRequired);
    this.organizationLocked = Boolean(response.organizationLocked);
    this.organizationName = response.selectedOrganizationName || response.organizationName || this.organizationName;
    this.selectedOrganizationId = response.selectedOrganizationId || response.organizationId || '';
    this.initialImport = response.initialImport || null;

    if (this.selectionRequired && this.accessibleOrganizations.length > 1) {
      this.clearImportPollTimer();
      this.status = 'selection_required';
      this.message = ZOHO_SELECTION_REQUIRED_MESSAGE;
      if (!this.selectedOrganizationId && this.accessibleOrganizations.length) {
        this.selectedOrganizationId = this.accessibleOrganizations[0].organizationId;
      }
      this.cdr.detectChanges();
      return;
    }

    if (!this.organizationName && this.accessibleOrganizations.length === 1) {
      const onlyOrganization = this.accessibleOrganizations[0];
      this.organizationName = onlyOrganization.name;
      this.selectedOrganizationId = onlyOrganization.organizationId;
    }

    if (this.shouldShowImportingState(this.initialImport)) {
      this.status = 'importing';
      this.message = this.buildImportMessage(this.initialImport);
      this.startImportPolling();
      this.cdr.detectChanges();
      return;
    }

    this.clearImportPollTimer();
    this.selectionRequired = false;
    this.status = 'success';
    this.message = ZOHO_SUCCESS_MESSAGE;
    this.cdr.detectChanges();
  }

  private applyOrganizationSelection(response: ZohoOrganizationSelectionResponse): void {
    this.selectionRequired = false;
    this.organizationLocked = true;
    this.statusError = '';
    this.initialImport = response.initialImport || null;
    this.selectionMessage = response.organizationName
      ? `Selected organization: ${response.organizationName}.`
      : (response.message || 'Zoho Books organization selected successfully.');
    this.organizationName = response.organizationName || this.organizationName;
    this.selectedOrganizationId = response.organizationId || this.selectedOrganizationId;

    if (this.shouldShowImportingState(this.initialImport)) {
      this.status = 'importing';
      this.message = this.buildImportMessage(this.initialImport);
      this.startImportPolling();
    } else {
      this.status = 'success';
      this.message = ZOHO_SUCCESS_MESSAGE;
      this.clearImportPollTimer();
    }

    this.cdr.detectChanges();
  }

  protected trackByImportModule(_: number, module: { key: string }): string {
    return module.key;
  }

  protected getModuleStatusLabel(status: string): string {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'running':
        return 'Running';
      case 'failed':
        return 'Failed';
      case 'pending':
        return 'Pending';
      default:
        return 'Waiting';
    }
  }

  protected getModuleStatusClass(status: string): string {
    if (status === 'completed') {
      return 'zoho-module-badge zoho-module-badge-success';
    }

    if (status === 'running') {
      return 'zoho-module-badge zoho-module-badge-running';
    }

    if (status === 'failed') {
      return 'zoho-module-badge zoho-module-badge-failed';
    }

    return 'zoho-module-badge zoho-module-badge-pending';
  }

  private shouldShowImportingState(initialImport: ZohoInitialImportState | null): boolean {
    const status = String(initialImport?.status || '').trim().toLowerCase();
    return status === 'pending_initial_import' || status === 'initial_import_running';
  }

  private buildImportMessage(initialImport: ZohoInitialImportState | null): string {
    const status = String(initialImport?.status || '').trim().toLowerCase();
    return status === 'pending_initial_import'
      ? 'We are preparing the initial Zoho Books import. Please wait.'
      : 'We are importing customer, quote, invoice, and payment data from Zoho Books. Please wait.';
  }

  private startImportPolling(): void {
    this.clearImportPollTimer();

    this.importPollTimer = window.setTimeout(() => {
      this.ngZone.run(() => this.loadZohoStatus());
    }, 3000);
  }

  private clearImportPollTimer(): void {
    if (this.importPollTimer) {
      window.clearTimeout(this.importPollTimer);
      this.importPollTimer = null;
    }
  }
}

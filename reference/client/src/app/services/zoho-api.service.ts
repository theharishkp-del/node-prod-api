import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { environment } from '../../environments/environment';
import {
  ZohoAutoSyncUpdateResponse,
  ZohoIntegrationStatusResponse,
  ZohoOrganizationSelectionResponse,
} from '../models/onboarding.models';
import { SKIP_GLOBAL_LOADING } from './loading-context';

@Injectable({ providedIn: 'root' })
export class ZohoApiService {
  private readonly http = inject(HttpClient);
  private readonly zohoStatusUrl = `${environment.api.baseUrl}${environment.api.endpoints.zohoStatus}`;
  private readonly zohoSelectOrganizationUrl = `${environment.api.baseUrl}${environment.api.endpoints.zohoSelectOrganization}`;
  private readonly zohoAutoSyncUrl = `${environment.api.baseUrl}${environment.api.endpoints.zohoAutoSync}`;

  getZohoStatus(botMasterKey: unknown) {
    return this.http.post<ZohoIntegrationStatusResponse>(this.zohoStatusUrl, { botMasterKey }, {
      context: new HttpContext().set(SKIP_GLOBAL_LOADING, true),
    });
  }

  selectZohoOrganization(botMasterKey: unknown, organizationId: string) {
    return this.http.post<ZohoOrganizationSelectionResponse>(this.zohoSelectOrganizationUrl, {
      botMasterKey,
      organizationId,
    }, {
      context: new HttpContext().set(SKIP_GLOBAL_LOADING, true),
    });
  }

  updateZohoAutoSync(botMasterKey: unknown, autoSyncEnabled: boolean) {
    return this.http.post<ZohoAutoSyncUpdateResponse>(this.zohoAutoSyncUrl, {
      botMasterKey,
      autoSyncEnabled,
    }, {
      context: new HttpContext().set(SKIP_GLOBAL_LOADING, true),
    });
  }
}

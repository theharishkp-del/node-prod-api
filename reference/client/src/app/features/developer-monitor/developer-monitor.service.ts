import { HttpClient, HttpContext, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { SKIP_GLOBAL_LOADING } from '../../services/loading-context';
import {
  DeveloperCollectionPreview,
  DeveloperCollectionDeleteResult,
  DeveloperMonitorLogsPayload,
  DeveloperMonitorOverview,
  DeveloperMonitorScope,
  MasterDataApiResponse,
} from '../master-data/shared/master-data.types';

@Injectable({ providedIn: 'root' })
export class DeveloperMonitorService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.api.baseUrl}/web/v1/developer-monitor`;

  getOverview(query: {
    developerKey: string;
    tenantId?: string;
    logLimit?: number;
    logLevel?: string;
    logSearch?: string;
    logDate?: string;
  }) {
    return this.get<DeveloperMonitorOverview>('overview', query);
  }

  getLogs(query: {
    developerKey: string;
    limit?: number;
    level?: string;
    search?: string;
    date?: string;
    kind?: string;
  }) {
    return this.get<DeveloperMonitorLogsPayload>('logs', query);
  }

  getCollectionPreview(developerKey: string, tenantId: string, scope: DeveloperMonitorScope, collectionName: string, limit = 10) {
    return this.get<DeveloperCollectionPreview>(`collections/${scope}/${encodeURIComponent(collectionName)}`, { developerKey, tenantId, limit });
  }

  deleteCollections(
    developerKey: string,
    tenantId: string,
    scope: DeveloperMonitorScope,
    collectionNames: string[],
    confirmationNames: string[],
  ) {
    return this.http.delete<MasterDataApiResponse<DeveloperCollectionDeleteResult>>(`${this.baseUrl}/collections/${scope}`, {
      headers: new HttpHeaders({ 'x-developer-monitor-key': String(developerKey || '') }),
      params: new HttpParams().set('tenantId', tenantId).set('_ts', Date.now()),
      body: { collectionNames, confirmationNames },
      context: new HttpContext().set(SKIP_GLOBAL_LOADING, true),
    });
  }

  createCollection(developerKey: string, tenantId: string, scope: DeveloperMonitorScope, collectionName: string) {
    return this.request('post', `collections/${scope}`, developerKey, tenantId, { collectionName });
  }

  insertDocument(developerKey: string, tenantId: string, scope: DeveloperMonitorScope, collectionName: string, document: Record<string, unknown>) {
    return this.request('post', `collections/${scope}/${encodeURIComponent(collectionName)}/documents`, developerKey, tenantId, { document });
  }

  updateDocument(developerKey: string, tenantId: string, scope: DeveloperMonitorScope, collectionName: string, documentId: string, document: Record<string, unknown>) {
    return this.request('patch', `collections/${scope}/${encodeURIComponent(collectionName)}/documents/${encodeURIComponent(documentId)}`, developerKey, tenantId, { document });
  }

  deleteDocument(developerKey: string, tenantId: string, scope: DeveloperMonitorScope, collectionName: string, documentId: string) {
    return this.request('delete', `collections/${scope}/${encodeURIComponent(collectionName)}/documents/${encodeURIComponent(documentId)}`, developerKey, tenantId);
  }

  private request(method: 'post' | 'patch' | 'delete', path: string, developerKey: string, tenantId: string, body?: unknown) {
    return this.http.request<MasterDataApiResponse<unknown>>(method, `${this.baseUrl}/${path}`, {
      headers: new HttpHeaders({ 'x-developer-monitor-key': String(developerKey || '') }),
      params: new HttpParams().set('tenantId', tenantId).set('_ts', Date.now()),
      body,
      context: new HttpContext().set(SKIP_GLOBAL_LOADING, true),
    });
  }

  private get<T>(path: string, query: Record<string, string | number | undefined>) {
    const { developerKey, ...paramsQuery } = query;
    let params = new HttpParams().set('_ts', Date.now());

    for (const [key, value] of Object.entries(paramsQuery)) {
      if (value !== undefined && value !== '') params = params.set(key, String(value));
    }

    return this.http.get<MasterDataApiResponse<T>>(`${this.baseUrl}/${path}`, {
      headers: new HttpHeaders({ 'x-developer-monitor-key': String(developerKey || '') }),
      params,
      // The monitor has its own per-panel loading states. Avoid blocking the
      // whole page while logs or document previews are refreshed.
      context: new HttpContext().set(SKIP_GLOBAL_LOADING, true),
    });
  }
}

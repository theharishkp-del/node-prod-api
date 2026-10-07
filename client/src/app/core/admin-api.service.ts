/**
 * @file Typed HTTP client for the admin API (/api/admin): organizations, bots, sessions and stats.
 */
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { API_BASE } from './api-base';
import {
  AdminStats,
  ApiResponse,
  Bot,
  BotInput,
  BotStatus,
  EoSession,
  Organization,
  OrganizationInput,
  OrgStatus,
  Page,
} from './models';

/** Query parameters accepted by list endpoints (empty values are dropped). */
export type ListQuery = Record<string, string | number | null | undefined>;

/** Typed client of the admin API ({ success, data, meta } envelopes unwrapped). */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);
  readonly base = API_BASE;

  private url(path: string): string {
    return `${this.base}${path.replace(/^\//, '')}`;
  }

  private params(query: ListQuery = {}): HttpParams {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== null && v !== undefined && v !== '') params = params.set(k, String(v));
    }
    return params;
  }

  private getData<T>(path: string, query?: ListQuery): Observable<T> {
    return this.http.get<ApiResponse<T>>(this.url(path), { params: this.params(query) }).pipe(map((r) => r.data));
  }

  private getPage<T>(path: string, query?: ListQuery): Observable<Page<T>> {
    return this.http
      .get<ApiResponse<T[]>>(this.url(path), { params: this.params(query) })
      .pipe(map((r) => ({ items: r.data, meta: r.meta! })));
  }

  private send<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Observable<T> {
    return this.http.request<ApiResponse<T>>(method, this.url(path), { body }).pipe(map((r) => r.data));
  }

  /** Verify the admin key (works without MongoDB). */
  checkAuth(key?: string | null): Observable<{ ok: boolean; authRequired: boolean }> {
    const headers: Record<string, string> = key ? { 'x-admin-key': key } : {};
    return this.http
      .get<ApiResponse<{ ok: boolean; authRequired: boolean }>>(this.url('auth/check'), { headers })
      .pipe(map((r) => r.data));
  }

  stats(): Observable<AdminStats> {
    return this.getData<AdminStats>('stats');
  }

  // Organizations
  listOrganizations(query: ListQuery): Observable<Page<Organization>> {
    return this.getPage<Organization>('organizations', query);
  }
  getOrganization(orgId: string): Observable<Organization> {
    return this.getData<Organization>(`organizations/${encodeURIComponent(orgId)}`);
  }
  createOrganization(input: OrganizationInput): Observable<Organization> {
    return this.send<Organization>('POST', 'organizations', input);
  }
  updateOrganization(orgId: string, input: OrganizationInput): Observable<Organization> {
    return this.send<Organization>('PATCH', `organizations/${encodeURIComponent(orgId)}`, input);
  }
  setOrganizationStatus(orgId: string, status: OrgStatus): Observable<Organization> {
    return this.send<Organization>('PATCH', `organizations/${encodeURIComponent(orgId)}/status`, { status });
  }
  deleteOrganization(orgId: string): Observable<unknown> {
    return this.send('DELETE', `organizations/${encodeURIComponent(orgId)}`);
  }

  // Sessions (tenant DB of an organization)
  listSessions(orgId: string, query: ListQuery): Observable<Page<EoSession>> {
    return this.getPage<EoSession>(`organizations/${encodeURIComponent(orgId)}/sessions`, query);
  }
  getSession(orgId: string, id: string): Observable<EoSession> {
    return this.getData<EoSession>(`organizations/${encodeURIComponent(orgId)}/sessions/${encodeURIComponent(id)}`);
  }

  // Bots
  listBots(query: ListQuery): Observable<Page<Bot>> {
    return this.getPage<Bot>('bots', query);
  }
  getBot(botUserId: string): Observable<Bot> {
    return this.getData<Bot>(`bots/${encodeURIComponent(botUserId)}`);
  }
  createBot(input: BotInput): Observable<Bot> {
    return this.send<Bot>('POST', 'bots', input);
  }
  updateBot(botUserId: string, input: BotInput): Observable<Bot> {
    return this.send<Bot>('PATCH', `bots/${encodeURIComponent(botUserId)}`, input);
  }
  setBotStatus(botUserId: string, status: BotStatus): Observable<Bot> {
    return this.send<Bot>('PATCH', `bots/${encodeURIComponent(botUserId)}/status`, { status });
  }
  deleteBot(botUserId: string): Observable<unknown> {
    return this.send('DELETE', `bots/${encodeURIComponent(botUserId)}`);
  }
}

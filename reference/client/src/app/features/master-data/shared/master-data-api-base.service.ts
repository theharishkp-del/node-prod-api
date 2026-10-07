import { HttpClient, HttpContext, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AppDialogService } from '../../../services/app-dialog.service';
import { BotMasterKeyService } from '../../../services/bot-master-key.service';
import { SKIP_GLOBAL_LOADING } from '../../../services/loading-context';
import { DashboardSummaryQuery, MasterDataApiResponse, MasterDataListQuery, ReportDownloadQuery } from './master-data.types';

type QueryParamValue = string | number | boolean | null | undefined;

@Injectable({ providedIn: 'root' })
export class MasterDataApiBaseService {
  protected readonly http = inject(HttpClient);
  private readonly appDialogService = inject(AppDialogService);
  private readonly botMasterKeyService = inject(BotMasterKeyService);
  protected readonly baseUrl = `${environment.api.baseUrl}${environment.api.endpoints.masterDataBase}`;

  protected buildHeaders(): HttpHeaders {
    const botMasterKey = this.botMasterKeyService.botMasterKey();
    const botUserId = String(botMasterKey?.botId ?? '').trim();
    const headers: Record<string, string> = {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    };

    if (botUserId) {
      headers['x-bot-user-id'] = botUserId;
    }

    if (botMasterKey) {
      headers['x-bot-master-key'] = JSON.stringify(botMasterKey);
    }

    return new HttpHeaders(headers);
  }

  protected buildParams(query: MasterDataListQuery = {}): HttpParams {
    let params = new HttpParams().set('_ts', Date.now());

    if (query.search) {
      params = params.set('search', query.search);
    }

    if (query.customerSearch) {
      params = params.set('customerSearch', query.customerSearch);
    }

    if (query.dateFrom) {
      params = params.set('dateFrom', query.dateFrom);
    }

    if (query.dateTo) {
      params = params.set('dateTo', query.dateTo);
    }

    if (query.status) {
      params = params.set('status', query.status);
    }

    if (query.paymentStatus) {
      params = params.set('paymentStatus', query.paymentStatus);
    }

    if (query.page) {
      params = params.set('page', query.page);
    }

    if (query.pageSize) {
      params = params.set('pageSize', query.pageSize);
    }

    return params;
  }

  protected buildResourceParams(query: DashboardSummaryQuery = {}): HttpParams {
    let params = new HttpParams().set('_ts', Date.now());

    if (query.period) {
      params = params.set('period', query.period);
    }

    if (query.from) {
      params = params.set('from', query.from);
    }

    if (query.to) {
      params = params.set('to', query.to);
    }

    return params;
  }

  protected buildDownloadParams(query: ReportDownloadQuery = {}): HttpParams {
    let params = new HttpParams().set('_ts', Date.now());

    if (query.search) {
      params = params.set('search', query.search);
    }

    if (query.period) {
      params = params.set('period', query.period);
    }

    if (query.from) {
      params = params.set('from', query.from);
    }

    if (query.to) {
      params = params.set('to', query.to);
    }

    if (query.customerId) {
      params = params.set('customerId', query.customerId);
    }

    if (query.page) {
      params = params.set('page', query.page);
    }

    if (query.pageSize) {
      params = params.set('pageSize', query.pageSize);
    }

    return params;
  }

  protected buildGenericParams(query: Record<string, QueryParamValue> = {}): HttpParams {
    let params = new HttpParams().set('_ts', Date.now());

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }

      params = params.set(key, String(value));
    }

    return params;
  }

  protected buildContext(): HttpContext {
    return new HttpContext().set(SKIP_GLOBAL_LOADING, true);
  }

  protected getList<T>(path: string, query: MasterDataListQuery = {}) {
    return this.http.get<MasterDataApiResponse<T[]>>(`${this.baseUrl}/${path}`, {
      headers: this.buildHeaders(),
      params: this.buildParams(query),
      context: this.buildContext(),
    }).pipe(catchError((error) => this.handleAccessDenied(error)));
  }

  protected getItem<T>(path: string, id: string) {
    return this.http.get<MasterDataApiResponse<T>>(`${this.baseUrl}/${path}/${id}`, {
      headers: this.buildHeaders(),
      context: this.buildContext(),
    }).pipe(catchError((error) => this.handleAccessDenied(error)));
  }

  protected getResource<T>(path: string) {
    return this.http.get<MasterDataApiResponse<T>>(`${this.baseUrl}/${path}`, {
      headers: this.buildHeaders(),
      context: this.buildContext(),
    }).pipe(catchError((error) => this.handleAccessDenied(error)));
  }

  protected getResourceWithQuery<T>(path: string, query: DashboardSummaryQuery = {}) {
    return this.http.get<MasterDataApiResponse<T>>(`${this.baseUrl}/${path}`, {
      headers: this.buildHeaders(),
      params: this.buildResourceParams(query),
      context: this.buildContext(),
    }).pipe(catchError((error) => this.handleAccessDenied(error)));
  }

  protected getResourceWithGenericQuery<T>(path: string, query: Record<string, QueryParamValue> = {}) {
    return this.http.get<MasterDataApiResponse<T>>(`${this.baseUrl}/${path}`, {
      headers: this.buildHeaders(),
      params: this.buildGenericParams(query),
      context: this.buildContext(),
    }).pipe(catchError((error) => this.handleAccessDenied(error)));
  }

  protected createItem<T>(path: string, payload: unknown) {
    return this.http.post<MasterDataApiResponse<T>>(`${this.baseUrl}/${path}`, payload, {
      headers: this.buildHeaders(),
      context: this.buildContext(),
    }).pipe(catchError((error) => this.handleAccessDenied(error)));
  }

  protected updateItem<T>(path: string, id: string, payload: unknown) {
    return this.http.put<MasterDataApiResponse<T>>(`${this.baseUrl}/${path}/${id}`, payload, {
      headers: this.buildHeaders(),
      context: this.buildContext(),
    }).pipe(catchError((error) => this.handleAccessDenied(error)));
  }

  protected deleteItem(path: string, id: string) {
    return this.http.delete<MasterDataApiResponse<Record<string, never>>>(`${this.baseUrl}/${path}/${id}`, {
      headers: this.buildHeaders(),
      context: this.buildContext(),
    }).pipe(catchError((error) => this.handleAccessDenied(error)));
  }

  protected getBlob(path: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/${path}`, {
      headers: this.buildHeaders(),
      context: this.buildContext(),
      responseType: 'blob',
    }).pipe(catchError((error) => this.handleAccessDenied(error)));
  }

  protected getBlobWithQuery(path: string, query: ReportDownloadQuery = {}): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/${path}`, {
      headers: this.buildHeaders(),
      params: this.buildDownloadParams(query),
      context: this.buildContext(),
      responseType: 'blob',
    }).pipe(catchError((error) => this.handleAccessDenied(error)));
  }

  protected uploadForm<T>(path: string, formData: FormData) {
    return this.http.post<MasterDataApiResponse<T>>(`${this.baseUrl}/${path}`, formData, {
      headers: this.buildHeaders(),
      context: this.buildContext(),
    }).pipe(catchError((error) => this.handleAccessDenied(error)));
  }

  private handleAccessDenied<T>(error: T) {
    const statusCode = (error as { status?: number })?.status;
    const statusText = String((error as { error?: { status?: string } })?.error?.status || '').trim();

    if (
      (statusCode === 401 || statusCode === 403) &&
      (statusText === 'tenant_not_found' || statusText === 'access_denied')
    ) {
      if (!this.appDialogService.dialogState()) {
        this.appDialogService.open({
          title: 'Feature Access Required',
          message: 'You need the bot to use this feature. Thank you. Contact support team.',
          buttonLabel: 'Okay',
          variant: 'info',
        });
      }
    }

    return throwError(() => error);
  }
}

import { HttpClient, HttpContext, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AppDialogService } from '../../../services/app-dialog.service';
import { BotMasterKeyService } from '../../../services/bot-master-key.service';
import { SKIP_GLOBAL_LOADING } from '../../../services/loading-context';
import {
  AdminCalendarResponse,
  AdminCalendarWorkOrderDetails,
  MasterDataApiResponse,
} from '../shared/master-data.types';

@Injectable({ providedIn: 'root' })
export class AdminCalendarService {
  private readonly http = inject(HttpClient);
  private readonly appDialogService = inject(AppDialogService);
  private readonly botMasterKeyService = inject(BotMasterKeyService);
  private readonly baseUrl = `${environment.api.baseUrl}${environment.api.endpoints.masterDataBase}`;

  getEvents(from: string, to: string): Observable<MasterDataApiResponse<AdminCalendarResponse>> {
    const params = new HttpParams()
      .set('from', from)
      .set('to', to)
      .set('_ts', Date.now());

    console.log('[AdminCalendarService] Get events request', {
      requestUrl: `${this.baseUrl}/calendar/events`,
      from,
      to,
      botUserId: this.buildHeaders().get('x-bot-user-id'),
    });

    return this.http.get<MasterDataApiResponse<AdminCalendarResponse>>(`${this.baseUrl}/calendar/events`, {
      headers: this.buildHeaders(),
      params,
      context: this.buildContext(),
    }).pipe(catchError((error) => this.handleAccessDenied(error)));
  }

  getWorkOrderDetails(workOrderId: string): Observable<MasterDataApiResponse<AdminCalendarWorkOrderDetails>> {
    return this.http.get<MasterDataApiResponse<AdminCalendarWorkOrderDetails>>(`${this.baseUrl}/calendar/work-orders/${workOrderId}`, {
      headers: this.buildHeaders(),
      context: this.buildContext(),
    }).pipe(catchError((error) => this.handleAccessDenied(error)));
  }

  private buildHeaders(): HttpHeaders {
    const botMasterKey = this.botMasterKeyService.botMasterKey();
    const botUserId = String(botMasterKey?.botId ?? botMasterKey?.userId ?? '').trim();
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

  private buildContext(): HttpContext {
    return new HttpContext().set(SKIP_GLOBAL_LOADING, true);
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

import { HttpClient, HttpContext, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { AppDialogService } from '../../../services/app-dialog.service';
import { BotMasterKeyService } from '../../../services/bot-master-key.service';
import { SKIP_GLOBAL_LOADING } from '../../../services/loading-context';
import { environment } from '../../../../environments/environment';
import { CustomerHistoryResponse, MasterDataApiResponse } from '../shared/master-data.types';

@Injectable({ providedIn: 'root' })
export class CustomerHistoryService {
  private readonly httpClient = inject(HttpClient);
  private readonly appDialogService = inject(AppDialogService);
  private readonly botMasterKeyService = inject(BotMasterKeyService);
  private readonly baseUrl = `${environment.api.baseUrl}${environment.api.endpoints.masterDataBase}`;

  getCustomerHistory(encodedCustomerContext: string): Observable<MasterDataApiResponse<CustomerHistoryResponse>> {
    const requestUrl = `${this.baseUrl}/customer-history`;
    const params = new HttpParams().set('customer', encodedCustomerContext).set('_ts', Date.now());
    const headers = this.buildHeaders(encodedCustomerContext);

  

    return this.httpClient.get<MasterDataApiResponse<CustomerHistoryResponse>>(requestUrl, {
      headers,
      params,
      context: this.buildContext(),
    }).pipe(
      tap((response) => {
        // console.log('[CustomerHistoryService] Response received', response);
      }),
      catchError((error) => this.handleAccessDenied(error)),
    );
  }

  private buildHeaders(encodedCustomerContext: string): HttpHeaders {
    const botMasterKey = this.botMasterKeyService.botMasterKey();
    const botUserId = String(botMasterKey?.botId ?? botMasterKey?.userId ?? '').trim();
    const headers: Record<string, string> = {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      'x-customer-context': encodedCustomerContext,
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
    // console.error('[CustomerHistoryService] Request failed', error);

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

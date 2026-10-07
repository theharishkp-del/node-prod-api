import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface TrialBot {
  botId: string;
  noOfDays: number;
  minUsers?: number;
  maxUsers: number;
  trialStartDate: string | null;
  trialEndDate: string | null;
  trialEndMessage: string;
}

export interface TrialBotResponse {
  success: boolean;
  message: string;
  data?: TrialBot | TrialBot[];
}

@Injectable({
  providedIn: 'root',
})
export class TrialBotManagementService {
  private readonly baseUrl = `${environment.api.baseUrl}/admin/trial-bots`;

  constructor(private readonly http: HttpClient) {}

  private getDeveloperMonitorHeaders(): HttpHeaders {
    const developerKey = typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem('developerMonitorKey')?.trim() || ''
      : '';

    return new HttpHeaders({
      'x-developer-monitor-key': developerKey,
    });
  }

  listTrialBots(): Observable<TrialBotResponse> {
    return this.http.get<TrialBotResponse>(this.baseUrl, {
      headers: this.getDeveloperMonitorHeaders(),
    });
  }

  addTrialBot(botConfig: Partial<TrialBot>): Observable<TrialBotResponse> {
    return this.http.post<TrialBotResponse>(this.baseUrl, botConfig, {
      headers: this.getDeveloperMonitorHeaders(),
    });
  }

  updateTrialBot(botId: string, botConfig: Partial<TrialBot>): Observable<TrialBotResponse> {
    return this.http.put<TrialBotResponse>(`${this.baseUrl}/${botId}`, botConfig, {
      headers: this.getDeveloperMonitorHeaders(),
    });
  }

  removeTrialBot(botId: string): Observable<TrialBotResponse> {
    return this.http.delete<TrialBotResponse>(`${this.baseUrl}/${botId}`, {
      headers: this.getDeveloperMonitorHeaders(),
    });
  }
}

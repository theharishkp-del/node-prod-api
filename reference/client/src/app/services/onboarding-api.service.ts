import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { environment } from '../../environments/environment';
import {
  ApiRequestPreview,
  CompleteOnboardingResponse,
  CybotUserLookupPayload,
  CybotUserLookupResponse,
  ExistingOnboardingResponse,
} from '../models/onboarding.models';
import { OnboardingStateService } from './onboarding-state.service';
import { SKIP_GLOBAL_LOADING } from './loading-context';

@Injectable({ providedIn: 'root' })
export class OnboardingApiService {
  private readonly http = inject(HttpClient);
  private readonly onboardingState = inject(OnboardingStateService);
  private readonly lookupCybotUserUrl = `${environment.api.baseUrl}${environment.api.endpoints.lookupCybotUser}`;
  private readonly completeRegistrationUrl = `${environment.api.baseUrl}${environment.api.endpoints.completeRegistration}`;
  private readonly existingOnboardingUrl = `${environment.api.baseUrl}${environment.api.endpoints.existingOnboarding}`;

  lookupCybotUser(payload: CybotUserLookupPayload) {
    return this.http.post<CybotUserLookupResponse>(this.lookupCybotUserUrl, payload, {
      context: new HttpContext().set(SKIP_GLOBAL_LOADING, true),
    });
  }

  getExistingOnboarding(botMasterKey: unknown) {
    return this.http.post<ExistingOnboardingResponse>(this.existingOnboardingUrl, { botMasterKey });
  }

  buildCompleteRequestPreview(): ApiRequestPreview | null {
    const body = this.onboardingState.buildPayload();

    if (!body) {
      return null;
    }

    return {
      method: 'POST',
      url: this.completeRegistrationUrl,
      body,
    };
  }

  submitCompleteRegistration() {
    const body = this.onboardingState.buildPayload();

    if (!body) {
      throw new Error('Complete onboarding payload is not ready yet.');
    }

    return this.http.post<CompleteOnboardingResponse>(this.completeRegistrationUrl, body);
  }
}

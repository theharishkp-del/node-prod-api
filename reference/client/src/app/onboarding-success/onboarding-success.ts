import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BotMasterKeyService } from '../services/bot-master-key.service';
import { OnboardingStateService } from '../services/onboarding-state.service';

@Component({
  selector: 'app-onboarding-success',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './onboarding-success.html',
  styleUrl: './onboarding-success.css',
})
export class OnboardingSuccess implements OnInit {
  private readonly router = inject(Router);
  private readonly botMasterKeyService = inject(BotMasterKeyService);

  protected readonly onboardingState = inject(OnboardingStateService);
  protected closeBlockedMessage = '';

  ngOnInit(): void {
    if (!this.onboardingState.completionState()) {
      void this.router.navigate(['/company-details'], { queryParamsHandling: 'preserve' });
    }
  }

  protected backToBot(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.closeBlockedMessage = '';
    const redirectUrl = this.getRedirectUrl();

    if (window.opener && !window.opener.closed) {
      window.opener.focus();
    }

    window.parent?.postMessage({ type: 'closeForm' }, '*');

    window.setTimeout(() => {
      window.close();

      window.setTimeout(() => {
        if (!window.closed) {
          if (redirectUrl) {
            window.location.replace(redirectUrl);
            return;
          }

          window.location.href = 'about:blank';
          this.closeBlockedMessage = 'Your browser blocked automatic closing. Please close this tab manually.';
        }
      }, 300);
    }, 500);
  }

  private getRedirectUrl(): string | null {
    const redirectUrl = this.botMasterKeyService.botMasterKey()?.['redirectUrl'];

    if (typeof redirectUrl !== 'string') {
      return null;
    }

    const normalizedRedirectUrl = redirectUrl.trim();

    return normalizedRedirectUrl || null;
  }
}

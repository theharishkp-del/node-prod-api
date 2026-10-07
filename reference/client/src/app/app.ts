import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { BotMasterKeyService } from './services/bot-master-key.service';
import { OnboardingStateService } from './services/onboarding-state.service';
import { AppDialog } from './shared/app-dialog/app-dialog';
import { FullScreenLoader } from './shared/full-screen-loader/full-screen-loader';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterLink, RouterOutlet, FullScreenLoader, AppDialog],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  private readonly router = inject(Router);
  private readonly botMasterKeyService = inject(BotMasterKeyService);
  protected readonly onboardingState = inject(OnboardingStateService);

  protected readonly steps = [
    { title: 'Company Details', route: '/company-details' },
    { title: 'Branch Details', route: '/branch-details' },
    { title: 'Cybot User Registration', route: '/cybot-user-registration' },
  ];
  protected hideShell = false;
  protected showStepStrip = true;

  ngOnInit(): void {
    this.syncOnboardingStateFromUrl();

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd)
      )
      .subscribe(() => {
        this.syncOnboardingStateFromUrl();
      });
  }

  private syncOnboardingStateFromUrl(): void {
    const encodedKey = this.getEncodedKeyFromUrl();
    const onMissingKeyRoute = this.isMissingKeyRoute();
    const onSuccessRoute = this.isSuccessRoute();
    const onZohoCallbackRoute = this.isZohoCallbackRoute();
    const onDashboardRoute = this.isDashboardRoute();
    const onReportsRoute = this.isReportsRoute();
    const onMasterDataRoute = this.isMasterDataRoute();
    const onCustomerHistoryRoute = this.isCustomerHistoryRoute();
    const onAdminCalendarRoute = this.isAdminCalendarRoute();
    const onTemplateCalendarTestRoute = this.isTemplateCalendarTestRoute();
    const onProductUploadRoute = this.isProductUploadRoute();
    const onDeveloperMonitorRoute = this.isDeveloperMonitorRoute();
    const onCartSelectionRoute = this.isCartSelectionRoute();

    this.hideShell = onMissingKeyRoute || onSuccessRoute || onZohoCallbackRoute || onCartSelectionRoute;
    this.showStepStrip = !(onDashboardRoute || onReportsRoute || onMasterDataRoute || onCustomerHistoryRoute || onAdminCalendarRoute || onTemplateCalendarTestRoute || onProductUploadRoute || onDeveloperMonitorRoute);

    if (onCartSelectionRoute) {
      return;
    }
    if (!encodedKey) {
      this.onboardingState.resetAll();

      if (!onMissingKeyRoute && !onSuccessRoute && !onZohoCallbackRoute && !onDeveloperMonitorRoute) {
        void this.router.navigate(['/missing-key']);
      }

      return;
    }

    try {
      const decodedKey = this.botMasterKeyService.initializeFromEncodedKey(encodedKey);

      if (!decodedKey) {
        return;
      }

      this.onboardingState.saveBotMasterKey(decodedKey);

      if (onMissingKeyRoute) {
        void this.router.navigate(['/company-details'], {
          queryParams: { key: encodedKey },
        });
      }
    } catch {
      this.onboardingState.resetAll();

      if (!onMissingKeyRoute && !onSuccessRoute && !onZohoCallbackRoute && !onDeveloperMonitorRoute) {
        void this.router.navigate(['/missing-key']);
      }
    }
  }

  private getEncodedKeyFromUrl(): string | null {
    if (typeof window !== 'undefined') {
      const browserUrl = new URL(window.location.href);
      const browserKey = browserUrl.searchParams.get('key');

      if (browserKey) {
        return browserKey;
      }
    }

    const urlTree = this.router.parseUrl(this.router.url || '/');
    const queryKey = urlTree.queryParams['key'];

    if (queryKey) {
      return queryKey;
    }

    const primarySegments = urlTree.root.children['primary']?.segments ?? [];

    for (const segment of primarySegments) {
      if (segment.parameters['key']) {
        return segment.parameters['key'];
      }
    }

    return null;
  }

  private isMissingKeyRoute(): boolean {
    if (typeof window !== 'undefined') {
      return window.location.pathname.includes('/missing-key');
    }

    return this.router.url.startsWith('/missing-key');
  }

  private isSuccessRoute(): boolean {
    if (typeof window !== 'undefined') {
      return window.location.pathname.includes('/onboarding-success');
    }

    return this.router.url.startsWith('/onboarding-success');
  }

  private isZohoCallbackRoute(): boolean {
    if (typeof window !== 'undefined') {
      return window.location.pathname.includes('/zoho/callback');
    }

    return this.router.url.startsWith('/zoho/callback');
  }

  private isMasterDataRoute(): boolean {
    if (typeof window !== 'undefined') {
      return window.location.pathname.includes('/master-data');
    }

    return this.router.url.startsWith('/master-data');
  }

  private isDashboardRoute(): boolean {
    if (typeof window !== 'undefined') {
      return window.location.pathname.includes('/dashboard');
    }

    return this.router.url.startsWith('/dashboard');
  }

  private isReportsRoute(): boolean {
    if (typeof window !== 'undefined') {
      return window.location.pathname.includes('/reports');
    }

    return this.router.url.startsWith('/reports');
  }

  private isProductUploadRoute(): boolean {
    if (typeof window !== 'undefined') {
      return window.location.pathname.includes('/product-upload');
    }

    return this.router.url.startsWith('/product-upload');
  }

  private isCustomerHistoryRoute(): boolean {
    if (typeof window !== 'undefined') {
      return window.location.pathname.includes('/customer-history');
    }

    return this.router.url.startsWith('/customer-history');
  }

  private isAdminCalendarRoute(): boolean {
    if (typeof window !== 'undefined') {
      return window.location.pathname.includes('/admin-calendar');
    }

    return this.router.url.startsWith('/admin-calendar');
  }

  private isTemplateCalendarTestRoute(): boolean {
    if (typeof window !== 'undefined') {
      return window.location.pathname.includes('/template-calendar-test');
    }

    return this.router.url.startsWith('/template-calendar-test');
  }

  private isDeveloperMonitorRoute(): boolean {
    if (typeof window !== 'undefined') {
      return window.location.pathname.includes('/developer-monitor');
    }

    return this.router.url.startsWith('/developer-monitor');
  }

  private isCartSelectionRoute(): boolean {
    return typeof window !== 'undefined'
      ? window.location.pathname.includes('/cart-selection')
      : this.router.url.startsWith('/cart-selection');
  }

  protected isCurrentRoute(route: string): boolean {
    return this.router.url === route;
  }

  protected isStepEnabled(route: string): boolean {
    if (route === '/branch-details') {
      return this.onboardingState.canAccessBranchStep();
    }

    if (route === '/cybot-user-registration') {
      return this.onboardingState.canAccessCybotUserStep();
    }

    return true;
  }

  protected resetFlow(): void {
    this.onboardingState.resetAll();
    void this.router.navigate(['/company-details'], { queryParamsHandling: 'preserve' });
  }
}

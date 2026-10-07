import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { OnboardingStateService } from '../services/onboarding-state.service';

export const branchStepGuard: CanActivateFn = () => {
  const onboardingState = inject(OnboardingStateService);
  const router = inject(Router);
  const currentUrlTree = router.parseUrl(router.url);

  return onboardingState.canAccessBranchStep()
    ? true
    : router.createUrlTree(['/company-details'], { queryParams: currentUrlTree.queryParams });
};

export const cybotUserStepGuard: CanActivateFn = () => {
  const onboardingState = inject(OnboardingStateService);
  const router = inject(Router);
  const currentUrlTree = router.parseUrl(router.url);

  return onboardingState.canAccessCybotUserStep()
    ? true
    : router.createUrlTree(['/company-details'], { queryParams: currentUrlTree.queryParams });
};

import { Injectable, computed, signal } from '@angular/core';
import {
  BotMasterKeyValue,
  BranchValue,
  CompanyDetailsValue,
  CompleteOnboardingPayload,
  CybotUserRegistrationValue,
  OnboardingCompletionState,
  PlanConfig,
} from '../models/onboarding.models';

@Injectable({ providedIn: 'root' })
export class OnboardingStateService {
  private static readonly storageKey = 'ofa.onboarding-draft';
  private readonly botMasterKeySignal = signal<BotMasterKeyValue | null>(null);
  private readonly companyDetailsSignal = signal<CompanyDetailsValue | null>(null);
  private readonly branchesSignal = signal<BranchValue[] | null>(null);
  private readonly cybotUsersSignal = signal<CybotUserRegistrationValue[] | null>(null);
  private readonly planConfigSignal = signal<PlanConfig | null>(null);
  private readonly editModeSignal = signal(false);
  private readonly tenantIdSignal = signal<string | null>(null);
  private readonly customerIdSignal = signal<string | null>(null);
  private readonly completionStateSignal = signal<OnboardingCompletionState | null>(null);

  readonly botMasterKey = this.botMasterKeySignal.asReadonly();
  readonly companyDetails = this.companyDetailsSignal.asReadonly();
  readonly branches = this.branchesSignal.asReadonly();
  readonly cybotUsers = this.cybotUsersSignal.asReadonly();
  readonly planConfig = this.planConfigSignal.asReadonly();
  readonly isEditMode = this.editModeSignal.asReadonly();
  readonly tenantId = this.tenantIdSignal.asReadonly();
  readonly customerId = this.customerIdSignal.asReadonly();
  readonly completionState = this.completionStateSignal.asReadonly();

  readonly canAccessBranchStep = computed(() => !!this.companyDetailsSignal());
  readonly canAccessCybotUserStep = computed(
    () => !!this.companyDetailsSignal() && !!this.branchesSignal()?.length
  );
  readonly isComplete = computed(
    () =>
      !!this.companyDetailsSignal() &&
      !!this.branchesSignal()?.length &&
      !!this.cybotUsersSignal()?.length
  );

  constructor() {
    this.restoreDraft();
  }

  saveBotMasterKey(value: BotMasterKeyValue): void {
    if (this.isDifferentBotKey(value)) {
      this.clearDraftState();
    }

    this.botMasterKeySignal.set(value);
    this.persistDraft();
  }

  saveCompanyDetails(value: CompanyDetailsValue): void {
    this.companyDetailsSignal.set(value);
    this.persistDraft();
  }

  saveBranches(value: BranchValue[]): void {
    this.branchesSignal.set(value);
    this.persistDraft();
  }

  saveCybotUserRegistration(value: CybotUserRegistrationValue[]): void {
    this.cybotUsersSignal.set(value);
    this.persistDraft();
  }

  savePlanConfig(value: PlanConfig | null | undefined): void {
    this.planConfigSignal.set(value ?? null);
    this.persistDraft();
  }

  hydrateExistingOnboarding(payload: CompleteOnboardingPayload, tenantId?: string | null, customerId?: string | null): void {
    this.botMasterKeySignal.set(payload.botMasterKey);
    this.companyDetailsSignal.set(payload.companyDetails);
    this.branchesSignal.set(payload.branches);
    this.cybotUsersSignal.set(payload.cybotUsers);
    this.editModeSignal.set(true);
    this.tenantIdSignal.set(tenantId ?? null);
    this.customerIdSignal.set(customerId ?? null);
    this.persistDraft();
  }

  setCreateMode(): void {
    this.editModeSignal.set(false);
    this.tenantIdSignal.set(null);
    this.customerIdSignal.set(null);
    this.persistDraft();
  }

  saveCompletionState(value: OnboardingCompletionState): void {
    this.completionStateSignal.set(value);
  }

  clearCompletionState(): void {
    this.completionStateSignal.set(null);
  }

  buildPayload(): CompleteOnboardingPayload | null {
    const botMasterKey = this.botMasterKeySignal();
    const companyDetails = this.companyDetailsSignal();
    const branches = this.branchesSignal();
    const cybotUsers = this.cybotUsersSignal();

    if (!botMasterKey || !companyDetails || !branches?.length || !cybotUsers?.length) {
      return null;
    }

    return {
      botMasterKey,
      companyDetails,
      branches,
      cybotUsers,
    };
  }

  resetAll(): void {
    this.clearDraftState();
    this.clearStoredDraft();
  }

  private isDifferentBotKey(value: BotMasterKeyValue): boolean {
    const currentValue = this.botMasterKeySignal();

    if (!currentValue) {
      return false;
    }

    return String(currentValue.botId ?? currentValue.userId ?? '') !==
      String(value.botId ?? value.userId ?? '');
  }

  private persistDraft(): void {
    if (typeof sessionStorage === 'undefined') {
      return;
    }

    sessionStorage.setItem(OnboardingStateService.storageKey, JSON.stringify({
      botMasterKey: this.botMasterKeySignal(),
      companyDetails: this.companyDetailsSignal(),
      branches: this.branchesSignal(),
      cybotUsers: this.cybotUsersSignal(),
      planConfig: this.planConfigSignal(),
      editMode: this.editModeSignal(),
      tenantId: this.tenantIdSignal(),
      customerId: this.customerIdSignal(),
    }));
  }

  private restoreDraft(): void {
    if (typeof sessionStorage === 'undefined') {
      return;
    }

    try {
      const storedDraft = sessionStorage.getItem(OnboardingStateService.storageKey);
      const draft = storedDraft ? JSON.parse(storedDraft) : null;

      if (!draft || typeof draft !== 'object') {
        return;
      }

      this.botMasterKeySignal.set(draft.botMasterKey ?? null);
      this.companyDetailsSignal.set(draft.companyDetails ?? null);
      this.branchesSignal.set(draft.branches ?? null);
      this.cybotUsersSignal.set(draft.cybotUsers ?? null);
      this.planConfigSignal.set(draft.planConfig ?? null);
      this.editModeSignal.set(Boolean(draft.editMode));
      this.tenantIdSignal.set(draft.tenantId ?? null);
      this.customerIdSignal.set(draft.customerId ?? null);
    } catch {
      this.clearStoredDraft();
    }
  }

  private clearDraftState(): void {
    this.botMasterKeySignal.set(null);
    this.companyDetailsSignal.set(null);
    this.branchesSignal.set(null);
    this.cybotUsersSignal.set(null);
    this.planConfigSignal.set(null);
    this.editModeSignal.set(false);
    this.tenantIdSignal.set(null);
    this.customerIdSignal.set(null);
    this.completionStateSignal.set(null);
  }

  private clearStoredDraft(): void {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(OnboardingStateService.storageKey);
    }
  }
}

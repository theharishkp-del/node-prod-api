import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder, FormGroup, Validators, ReactiveFormsModule,
  AbstractControl, ValidationErrors,
} from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { AddressPicker, AddressValue } from '../address-picker/address-picker';
import { CompanyDetailsValue } from '../models/onboarding.models';
import { BotMasterKeyService } from '../services/bot-master-key.service';
import { OnboardingApiService } from '../services/onboarding-api.service';
import { OnboardingStateService } from '../services/onboarding-state.service';
import { COUNTRY_OPTIONS } from '../utils/country-options';
import { CURRENCY_OPTIONS } from '../utils/currency-options';
import { CountryCodeSelect } from '../shared/country-code-select/country-code-select';

function addressRequiredValidator(control: AbstractControl): ValidationErrors | null {
  const value = control.value as AddressValue;
  return value?.formattedAddress ? null : { addressRequired: true };
}

// at least one of businessEmail / phoneNumber must be filled
function emailOrPhoneValidator(group: AbstractControl): ValidationErrors | null {
  const email = group.get('businessEmail')?.value?.trim();
  const phone = group.get('phoneNumber')?.value?.trim();
  return email || phone ? null : { emailOrPhoneRequired: true };
}


@Component({
  selector: 'app-company-details',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, AddressPicker, CountryCodeSelect],
  templateUrl: './company-details.html',
  styleUrl: './company-details.css',
})
export class CompanyDetails implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly botMasterKeyService = inject(BotMasterKeyService);
  private readonly onboardingApi = inject(OnboardingApiService);
  protected readonly onboardingState = inject(OnboardingStateService);

  form!: FormGroup;
  submitting = false;
  loadingExisting = false;
  existingRecordMessage = '';
  existingRecordError = '';

  readonly countryCodes = COUNTRY_OPTIONS;
  readonly currencies = CURRENCY_OPTIONS;
  private detectedTimezone = '';

  private hasLookupIdentifiers(botMasterKey: unknown): boolean {
    if (!botMasterKey || typeof botMasterKey !== 'object') {
      return false;
    }

    const typedBotMasterKey = botMasterKey as {
      botId?: string | number;
      userId?: string | number;
    };

    return Boolean(
      String(typedBotMasterKey.botId ?? '').trim() ||
      String(typedBotMasterKey.userId ?? '').trim()
    );
  }

  ngOnInit(): void {
    this.detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    this.form = this.fb.group(
      {
        companyName: ['', Validators.required],
        businessEmail: ['', Validators.email],
        countryCode: ['+1'],
        phoneNumber: ['', Validators.pattern(/^[0-9\s-]{6,15}$/)],
        address: [{ formattedAddress: '', lat: null, lng: null }, addressRequiredValidator],
        website: ['', Validators.pattern(/^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/)],
        currency: ['USD', Validators.required],
      },
      { validators: emailOrPhoneValidator }
    );

    const existingValue = this.onboardingState.companyDetails();
    if (existingValue) {
      this.form.patchValue(existingValue);
    }

    const botMasterKey = this.botMasterKeyService.botMasterKey();
    const shouldLoadExisting = !existingValue && this.hasLookupIdentifiers(botMasterKey);

    if (botMasterKey?.companyName && !this.form.get('companyName')?.value) {
      this.form.patchValue({
        companyName: String(botMasterKey.companyName),
      });
    }

    if (shouldLoadExisting) {
      this.loadingExisting = true;
      this.loadExistingOnboarding(botMasterKey);
    }
  }

  get f() { return this.form.controls; }

  get showEmailOrPhoneError(): boolean {
    return this.form.hasError('emailOrPhoneRequired') &&
      (this.f['businessEmail'].touched || this.f['phoneNumber'].touched);
  }


  hasError(name: string, error: string): boolean {
    const c = this.form.get(name);
    return !!c && c.touched && c.hasError(error);
  }

  onCountryCodeChange(value: string): void {
    this.form.patchValue({ countryCode: value });
  }

  private loadExistingOnboarding(botMasterKey: unknown): void {
    this.existingRecordError = '';
    this.existingRecordMessage = '';

    this.onboardingApi.getExistingOnboarding(botMasterKey)
      .pipe(finalize(() => {
        this.loadingExisting = false;
      }))
      .subscribe({
        next: (response) => {
          this.onboardingState.savePlanConfig(response.planConfig);

          if (response.status === 'not_found' || !response.payload) {
            this.onboardingState.setCreateMode();
            return;
          }

          this.onboardingState.hydrateExistingOnboarding(
            response.payload,
            response.tenantId ?? null,
            response.customerId ?? null
          );
          this.form.patchValue(response.payload.companyDetails);
          this.existingRecordMessage = response.message;
        },
        error: (error) => {
          const errorMessage = String(error?.error?.message || '').trim();

          if (errorMessage === 'botUserId is required in payload.botUserId or botMasterKey.botId or botMasterKey.userId.') {
            this.onboardingState.setCreateMode();
            this.existingRecordError = '';
            return;
          }

          this.existingRecordError =
            errorMessage || 'Failed to load existing client onboarding data.';
        },
      });
  }




 onNext(): void {
    if (this.loadingExisting) {
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting = true;
    this.onboardingState.saveCompanyDetails({
      ...(this.form.getRawValue() as Omit<CompanyDetailsValue, 'timezone'>),
      timezone: this.detectedTimezone,
    });
    void this.router.navigate(['/branch-details'], { queryParamsHandling: 'preserve' });
    this.submitting = false;
  }

  onReset(): void {
    const existingValue = this.onboardingState.companyDetails();

    this.form.reset(existingValue ?? {
      companyName: '',
      businessEmail: '',
      countryCode: '+1',
      phoneNumber: '',
      address: { formattedAddress: '', lat: null, lng: null },
      website: '',
      currency: 'USD',
    });
  }

  onCancel(): void {
    this.onboardingState.resetAll();
    this.onReset();
  }
}

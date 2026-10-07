import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { CountryCodeSelect } from '../../../shared/country-code-select/country-code-select';
import { AppDialogService } from '../../../services/app-dialog.service';
import { COUNTRY_OPTIONS } from '../../../utils/country-options';
import { CURRENCY_OPTIONS } from '../../../utils/currency-options';
import { MasterDataCustomer, MasterDataFormMode, MasterDataTier } from '../shared/master-data.types';
import { buildNextDocumentNumber, extractNumberPrefix } from '../shared/document-number.util';

const DEFAULT_PHONE_DIGIT_RULE = { min: 6, max: 15 };

const PHONE_DIGIT_RULES: Record<string, { lengths?: number[]; min?: number; max?: number }> = {
  '+1': { lengths: [10] },
  '+7': { lengths: [10] },
  '+20': { lengths: [10] },
  '+27': { lengths: [9] },
  '+31': { lengths: [9] },
  '+33': { lengths: [9] },
  '+34': { lengths: [9] },
  '+39': { lengths: [9, 10] },
  '+44': { lengths: [10] },
  '+49': { min: 10, max: 11 },
  '+52': { lengths: [10] },
  '+55': { lengths: [10, 11] },
  '+60': { min: 9, max: 10 },
  '+61': { lengths: [9] },
  '+62': { min: 9, max: 12 },
  '+63': { lengths: [10] },
  '+64': { min: 8, max: 10 },
  '+65': { lengths: [8] },
  '+66': { lengths: [9] },
  '+81': { min: 10, max: 11 },
  '+84': { lengths: [9, 10] },
  '+86': { lengths: [11] },
  '+90': { lengths: [10] },
  '+91': { lengths: [10] },
  '+92': { lengths: [10] },
  '+94': { lengths: [9] },
  '+971': { lengths: [9] },
  '+966': { lengths: [9] },
  '+974': { lengths: [8] },
};

function emailOrPhoneValidator(group: AbstractControl): ValidationErrors | null {
  const email = String(group.get('email')?.value || '').trim();
  const phone = String(group.get('phone')?.value || '').trim();
  return email || phone ? null : { emailOrPhoneRequired: true };
}

function phoneLengthValidator(countryCodeControlName: string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const rawValue = String(control.value || '').trim();

    if (!rawValue) {
      return null;
    }

    const digits = rawValue.replace(/\D/g, '');

    if (digits.length !== rawValue.length) {
      return { phoneDigitsOnly: true };
    }

    const dialCode = String(control.parent?.get(countryCodeControlName)?.value || '').trim();
    const rule = PHONE_DIGIT_RULES[dialCode];

    if (rule?.lengths?.length) {
      return rule.lengths.includes(digits.length)
        ? null
        : { phoneLengthInvalid: { dialCode, lengths: rule.lengths } };
    }

    const min = rule?.min ?? DEFAULT_PHONE_DIGIT_RULE.min;
    const max = rule?.max ?? DEFAULT_PHONE_DIGIT_RULE.max;

    return digits.length >= min && digits.length <= max
      ? null
      : { phoneLengthInvalid: { dialCode, min, max } };
  };
}

@Component({
  selector: 'app-customer-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CountryCodeSelect],
  templateUrl: './customer-form.component.html',
  styleUrl: './customer-form.component.css',
})
export class CustomerFormComponent implements OnChanges {
  @Input() mode: MasterDataFormMode = 'create';
  @Input() customer: MasterDataCustomer | null = null;
  @Input() tiers: MasterDataTier[] = [];
  @Input() existingCustomerCodes: string[] = [];
  @Input() saving = false;
  @Input() errorMessage = '';
  @Output() saveRequested = new EventEmitter<Partial<MasterDataCustomer>>();
  @Output() cancelRequested = new EventEmitter<void>();

  private readonly appDialogService = inject(AppDialogService);
  private readonly fb = new FormBuilder();
  readonly countryCodes = COUNTRY_OPTIONS;
  readonly currencies = CURRENCY_OPTIONS;

  readonly form = this.fb.group({
    customerCodePrefix: ['CUST', Validators.required],
    customerCode: [''],
    tierId: ['', Validators.required],
    customerType: ['business', Validators.required],
    displayName: ['', [Validators.required, Validators.maxLength(150)]],
    companyName: ['', Validators.maxLength(150)],
    email: ['', [Validators.email, Validators.maxLength(254)]],
    phoneCountryCode: ['+1'],
    phone: ['', phoneLengthValidator('phoneCountryCode')],
    mobileCountryCode: ['+1'],
    mobile: ['', phoneLengthValidator('mobileCountryCode')],
    gstNumber: [''],
    taxTreatment: [''],
    billingAddress: ['', Validators.required],
    sameAsBillingAddress: [false],
    shippingAddress: [''],
    currencyCode: ['INR'],
    paymentTerms: [''],
    status: ['active', Validators.required],
  }, { validators: emailOrPhoneValidator });

  get isViewMode(): boolean {
    return this.mode === 'view';
  }

  get isCreateMode(): boolean {
    return this.mode === 'create';
  }

  onCancel(): void {
    // In view mode there are no edits — close immediately.
    if (this.isViewMode || !this.form.dirty) {
      this.cancelRequested.emit();
      return;
    }

    this.appDialogService.confirm({
      title: 'Discard Changes',
      message: 'You have unsaved changes. Are you sure you want to cancel?',
      buttonLabel: 'Discard',
      cancelLabel: 'Keep Editing',
      onConfirm: () => this.cancelRequested.emit(),
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['customer'] || changes['mode']) {
      const value = this.customer;
      const customerCodePrefix = extractNumberPrefix(value?.customerCode ?? '', 'CUST');
      const defaultTierId = this.resolveDefaultTierId();

      this.form.reset({
        customerCodePrefix,
        customerCode: value?.customerCode ?? '',
        tierId: value?.tierId ?? defaultTierId,
        customerType: value?.customerType ?? 'business',
        displayName: value?.displayName ?? '',
        companyName: value?.companyName ?? '',
        email: value?.email ?? '',
        phoneCountryCode: value?.phoneCountryCode ?? '+1',
        phone: value?.phone ?? '',
        mobileCountryCode: value?.mobileCountryCode ?? '+1',
        mobile: value?.mobile ?? '',
        gstNumber: value?.gstNumber ?? '',
        taxTreatment: value?.taxTreatment ?? '',
        billingAddress: value?.billingAddress ?? '',
        sameAsBillingAddress: value?.shippingAddress != null && value?.shippingAddress === value?.billingAddress,
        shippingAddress: value?.shippingAddress ?? '',
        currencyCode: value?.currencyCode ?? 'INR',
        paymentTerms: value?.paymentTerms ?? '',
        status: value?.status ?? 'active',
      });
    }

    if (changes['tiers'] && !changes['customer'] && !changes['mode']) {
      const currentTierId = String(this.form.get('tierId')?.value || '').trim();

      if (!currentTierId) {
        this.form.patchValue({ tierId: this.resolveDefaultTierId() }, { emitEvent: false });
      }
    }

    if (changes['mode']) {
      if (this.isViewMode) {
        this.form.disable({ emitEvent: false });
      } else {
        this.form.enable({ emitEvent: false });
      }
    }

    if (changes['customer'] || changes['mode']) {
      if (this.isViewMode) {
        this.form.get('customerCodePrefix')?.disable({ emitEvent: false });
        this.form.get('customerCode')?.disable({ emitEvent: false });
      } else if (this.isCreateMode) {
        this.form.get('customerCode')?.disable({ emitEvent: false });
        this.updateGeneratedCustomerCode();
      } else {
        this.form.get('customerCodePrefix')?.disable({ emitEvent: false });
        this.form.get('customerCode')?.enable({ emitEvent: false });
      }
    }

    this.syncShippingAddressControl();
  }

  onCustomerCodePrefixChange(): void {
    if (!this.isCreateMode || this.isViewMode) {
      return;
    }

    this.updateGeneratedCustomerCode();
  }

  onPhoneCountryCodeChange(value: string): void {
    this.form.patchValue({ phoneCountryCode: value });
    this.form.get('phone')?.updateValueAndValidity();
  }

  onMobileCountryCodeChange(value: string): void {
    this.form.patchValue({ mobileCountryCode: value });
    this.form.get('mobile')?.updateValueAndValidity();
  }

  onSameAsBillingChange(): void {
    this.syncShippingAddressControl();
  }

  onSubmit(): void {
    if (this.isViewMode) {
      this.cancelRequested.emit();
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const formValue = this.form.getRawValue();
    const sameAsBilling = Boolean(formValue.sameAsBillingAddress);

    this.saveRequested.emit({
      customerCode: formValue.customerCode ?? '',
      tierId: formValue.tierId ?? '',
      customerType: formValue.customerType as MasterDataCustomer['customerType'],
      displayName: formValue.displayName ?? '',
      companyName: formValue.companyName ?? '',
      email: formValue.email ?? '',
      phoneCountryCode: formValue.phoneCountryCode ?? '+1',
      phone: formValue.phone ?? '',
      mobileCountryCode: formValue.mobileCountryCode ?? '+1',
      mobile: formValue.mobile ?? '',
      gstNumber: formValue.gstNumber ?? '',
      taxTreatment: formValue.taxTreatment ?? '',
      billingAddress: formValue.billingAddress ?? '',
      shippingAddress: sameAsBilling ? (formValue.billingAddress ?? '') : (formValue.shippingAddress ?? ''),
      currencyCode: formValue.currencyCode ?? 'INR',
      paymentTerms: formValue.paymentTerms ?? '',
      status: formValue.status as MasterDataCustomer['status'],
    });
  }

  getPhoneLengthErrorMessage(controlName: 'phone' | 'mobile', countryCodeControlName: 'phoneCountryCode' | 'mobileCountryCode'): string {
    const control = this.form.get(controlName);

    if (!control?.hasError('phoneLengthInvalid')) {
      return '';
    }

    const error = control.getError('phoneLengthInvalid') as {
      dialCode?: string;
      lengths?: number[];
      min?: number;
      max?: number;
    };
    const dialCode = String(this.form.get(countryCodeControlName)?.value || error?.dialCode || '').trim();

    if (Array.isArray(error?.lengths) && error.lengths.length > 0) {
      const expectedLengths = error.lengths.join(' or ');
      return `${controlName === 'phone' ? 'Phone number' : 'Mobile number'} for ${dialCode || 'the selected country code'} must be ${expectedLengths} digits.`;
    }

    return `${controlName === 'phone' ? 'Phone number' : 'Mobile number'} for ${dialCode || 'the selected country code'} must be between ${error?.min ?? DEFAULT_PHONE_DIGIT_RULE.min} and ${error?.max ?? DEFAULT_PHONE_DIGIT_RULE.max} digits.`;
  }

  private updateGeneratedCustomerCode(): void {
    const prefix = String(this.form.get('customerCodePrefix')?.value || 'CUST').trim().toUpperCase() || 'CUST';
    const customerCode = buildNextDocumentNumber(this.existingCustomerCodes, prefix);

    this.form.patchValue({
      customerCodePrefix: prefix,
      customerCode,
    }, { emitEvent: false });
  }

  private syncShippingAddressControl(): void {
    const sameAsBilling = Boolean(this.form.get('sameAsBillingAddress')?.value);
    const shippingAddressControl = this.form.get('shippingAddress');

    if (!shippingAddressControl) {
      return;
    }

    if (sameAsBilling) {
      shippingAddressControl.setValue(this.form.get('billingAddress')?.value || '', { emitEvent: false });
      shippingAddressControl.disable({ emitEvent: false });
      return;
    }

    if (!this.isViewMode) {
      shippingAddressControl.enable({ emitEvent: false });
    }
  }

  private resolveDefaultTierId(): string {
    return this.tiers.find((tier) => tier.tierKey === 'T1')?.id || this.tiers[0]?.id || '';
  }
}

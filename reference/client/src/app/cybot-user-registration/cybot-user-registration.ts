import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import {
  CybotUserLookupResponse,
  CybotUserRegistrationValue,
} from '../models/onboarding.models';
import { CountryCodeSelect } from '../shared/country-code-select/country-code-select';
import { OnboardingApiService } from '../services/onboarding-api.service';
import { OnboardingStateService } from '../services/onboarding-state.service';
import { COUNTRY_OPTIONS } from '../utils/country-options';

@Component({
  selector: 'app-cybot-user-registration',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CountryCodeSelect],
  templateUrl: './cybot-user-registration.html',
  styleUrl: './cybot-user-registration.css',
})
export class CybotUserRegistration implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly onboardingState = inject(OnboardingStateService);
  private readonly onboardingApi = inject(OnboardingApiService);

  readonly countryCodes = COUNTRY_OPTIONS;
  readonly addedStaff = signal<CybotUserRegistrationValue[]>([]);
  readonly foundUser = signal<CybotUserLookupResponse['userDetails'] | null>(null);
  readonly lookupMode = signal<'email' | 'phone'>('email');
  readonly lookupState = signal<'idle' | 'loading' | 'found' | 'not_found' | 'error'>('idle');
  readonly showRolePicker = signal(false);

  readonly roleCounts = computed(() => {
    const staff = this.addedStaff();

    return staff.reduce(
      (counts, member) => {
        counts[member.role] += 1;
        return counts;
      },
      { Admin: 0, Technician: 0 } as Record<CybotUserRegistrationValue['role'], number>
    );
  });

  readonly maxUsers = computed(() => this.onboardingState.planConfig()?.limits.maxUsers ?? 3);
  readonly remainingUserSlots = computed(() => Math.max(this.maxUsers() - this.addedStaff().length, 0));
  readonly hasReachedUserLimit = computed(() => this.addedStaff().length >= this.maxUsers());

  lookupMessage = '';
  lookupNotFoundMessage = '';
  staffError = '';
  submissionError = '';
  isLookingUp = false;
  isSubmitting = false;
  requestPreview = this.onboardingApi.buildCompleteRequestPreview();

  readonly lookupForm = this.fb.group({
    emailId: ['', [Validators.required, Validators.email]],
    countryCode: ['+1', Validators.required],
    phoneNumber: ['', Validators.pattern(/^[0-9]{6,15}$/)],
  });

  ngOnInit(): void {
    const existingUsers = this.onboardingState.cybotUsers() ?? [];
    if (existingUsers.length) {
      this.addedStaff.set(existingUsers);
      this.requestPreview = this.onboardingApi.buildCompleteRequestPreview();
    }
  }

  hasLookupError(name: 'emailId' | 'phoneNumber', error: string): boolean {
    const control = this.lookupForm.get(name);
    return !!control && control.touched && control.hasError(error);
  }

  onCountryCodeChange(value: string): void {
    this.lookupForm.patchValue({ countryCode: value });
  }

  setLookupMode(mode: 'email' | 'phone'): void {
    if (this.lookupMode() === mode) {
      return;
    }

    this.lookupMode.set(mode);
    this.lookupMessage = '';
    this.lookupNotFoundMessage = '';
    this.staffError = '';
    this.submissionError = '';
    this.lookupState.set('idle');
    this.foundUser.set(null);
    this.showRolePicker.set(false);

    const emailControl = this.lookupForm.get('emailId');
    const phoneControl = this.lookupForm.get('phoneNumber');

    if (mode === 'email') {
      emailControl?.setValidators([Validators.required, Validators.email]);
      phoneControl?.setValidators(Validators.pattern(/^[0-9]{6,15}$/));
      this.lookupForm.patchValue({ phoneNumber: '' });
      phoneControl?.markAsUntouched();
    } else {
      emailControl?.setValidators(Validators.email);
      phoneControl?.setValidators([Validators.required, Validators.pattern(/^[0-9]{6,15}$/)]);
      this.lookupForm.patchValue({ emailId: '' });
      emailControl?.markAsUntouched();
    }

    emailControl?.updateValueAndValidity();
    phoneControl?.updateValueAndValidity();
  }

  onBack(): void {
    void this.router.navigate(['/branch-details'], { queryParamsHandling: 'preserve' });
  }

  onResetLookup(): void {
    this.lookupForm.reset({
      emailId: '',
      countryCode: '+1',
      phoneNumber: '',
    });
    this.lookupMode.set('email');
    this.lookupForm.get('emailId')?.setValidators([Validators.required, Validators.email]);
    this.lookupForm.get('phoneNumber')?.setValidators(Validators.pattern(/^[0-9]{6,15}$/));
    this.lookupForm.get('emailId')?.updateValueAndValidity();
    this.lookupForm.get('phoneNumber')?.updateValueAndValidity();
    this.lookupMessage = '';
    this.lookupNotFoundMessage = '';
    this.staffError = '';
    this.submissionError = '';
    this.lookupState.set('idle');
    this.foundUser.set(null);
    this.showRolePicker.set(false);
  }

  onFindUser(): void {
    if (this.lookupForm.invalid) {
      this.lookupForm.markAllAsTouched();
      return;
    }

    const botMasterKey = this.onboardingState.botMasterKey();
    const lookupPayload = {
      botMasterKey,
      databaseName: botMasterKey?.databaseName ? String(botMasterKey.databaseName) : undefined,
      emailId: String(this.lookupForm.get('emailId')?.value || '').trim(),
      countryCode: String(this.lookupForm.get('countryCode')?.value || '').trim(),
      phoneNumber: String(this.lookupForm.get('phoneNumber')?.value || '').trim(),
    };

    this.isLookingUp = true;
    this.lookupMessage = '';
    this.lookupNotFoundMessage = '';
    this.staffError = '';
    this.submissionError = '';
    this.lookupState.set('loading');
    this.foundUser.set(null);
    this.showRolePicker.set(false);

    this.onboardingApi.lookupCybotUser(lookupPayload)
      .pipe(finalize(() => {
        this.isLookingUp = false;
      }))
      .subscribe({
        next: (response) => {
          this.isLookingUp = false;

          if (response.status === 'not_found') {
            this.lookupMessage = '';
            this.lookupNotFoundMessage = this.buildNotFoundMessage();
            this.lookupState.set('not_found');
            this.foundUser.set(null);
            this.submissionError = '';
            return;
          }

          this.lookupMessage = response.message;
          this.lookupNotFoundMessage = '';
          this.lookupState.set('found');
          this.foundUser.set(response.userDetails ?? null);
          this.openRolePickerAfterLookup();
        },
        error: (error) => {
          this.isLookingUp = false;
          this.lookupMessage = '';
          this.foundUser.set(null);
          this.lookupNotFoundMessage = '';
          this.lookupState.set('error');
          this.submissionError =
            error?.error?.message || 'Cybot user lookup failed.';
        },
      });
  }

  private buildNotFoundMessage(): string {
    if (this.lookupMode() === 'phone') {
      const countryCode = String(this.lookupForm.get('countryCode')?.value || '').trim();
      const phoneNumber = String(this.lookupForm.get('phoneNumber')?.value || '').trim();
      return `No user found for the phone number ${countryCode} ${phoneNumber}. Please check the details you entered.`;
    }

    const emailId = String(this.lookupForm.get('emailId')?.value || '').trim();
    return `No user found for the email ${emailId}. Please check the details you entered.`;
  }

  private openRolePickerAfterLookup(): void {
    queueMicrotask(() => {
      if (!this.foundUser()) {
        return;
      }

      this.staffError = '';
      this.showRolePicker.set(true);
    });
  }

  openRolePicker(): void {
    if (!this.foundUser()) {
      this.staffError = 'Find a Cybot user before choosing a role.';
      return;
    }

    this.staffError = '';
    this.showRolePicker.set(true);
  }

  closeRolePicker(): void {
    this.showRolePicker.set(false);
  }

  onAddStaff(role: CybotUserRegistrationValue['role']): void {
    const foundUser = this.foundUser();

    if (!foundUser) {
      this.staffError = 'Find a Cybot user before adding staff.';
      return;
    }

    if (this.hasReachedUserLimit()) {
      this.staffError = `Your plan allows a maximum of ${this.maxUsers()} Cybot users.`;
      this.showRolePicker.set(false);
      return;
    }

    const nextEntry: CybotUserRegistrationValue = {
      ...foundUser,
      role,
    };

    const duplicateMember = this.addedStaff().find((member) => member.id === nextEntry.id);

    if (duplicateMember) {
      this.staffError = `This user is already added as ${duplicateMember.role}. A user can only be assigned once per organization.`;
      this.showRolePicker.set(false);
      return;
    }

    const updatedStaff = [...this.addedStaff(), nextEntry];
    this.addedStaff.set(updatedStaff);
    this.onboardingState.saveCybotUserRegistration(updatedStaff);
    this.requestPreview = this.onboardingApi.buildCompleteRequestPreview();
    this.staffError = '';
    this.lookupMessage = `${foundUser.firstName} ${foundUser.lastName}`.trim() + ' added successfully.';
    this.lookupNotFoundMessage = '';
    this.lookupState.set('idle');
    this.foundUser.set(null);
    this.showRolePicker.set(false);
    this.lookupForm.patchValue({
      emailId: '',
      phoneNumber: '',
    });
    this.lookupForm.markAsPristine();
    this.lookupForm.markAsUntouched();
  }

  onDeleteStaff(memberId: string, role: CybotUserRegistrationValue['role']): void {
    const updatedStaff = this.addedStaff().filter(
      (member) => !(member.id === memberId && member.role === role)
    );

    this.addedStaff.set(updatedStaff);
    this.onboardingState.saveCybotUserRegistration(updatedStaff);
    this.requestPreview = this.onboardingApi.buildCompleteRequestPreview();
  }

  onComplete(): void {
    const staff = this.addedStaff();
    const roleCounts = this.roleCounts();

    if (!staff.length) {
      this.staffError = 'Add at least one staff member before submitting.';
      return;
    }

    if (staff.length > this.maxUsers()) {
      this.staffError = `Your plan allows a maximum of ${this.maxUsers()} Cybot users.`;
      return;
    }

    const limits = this.onboardingState.planConfig()?.limits;
    const minAdmins = limits?.minAdmins ?? 1;
    const minTechnicians = limits?.minTechnicians ?? 1;

    if (roleCounts.Admin < minAdmins || roleCounts.Technician < minTechnicians) {
      this.staffError = `At least ${minAdmins} Admin and ${minTechnicians} Technician user(s) are required.`;
      return;
    }

    this.onboardingState.saveCybotUserRegistration(staff);
    this.requestPreview = this.onboardingApi.buildCompleteRequestPreview();
    this.submissionError = '';
    this.staffError = '';
    this.isSubmitting = true;

    this.onboardingApi.submitCompleteRegistration()
      .pipe(finalize(() => {
        this.isSubmitting = false;
      }))
      .subscribe({
        next: (response) => {
          this.onboardingState.saveCompletionState({
            operation: response.status,
            message: response.message,
          });
          this.requestPreview = this.onboardingApi.buildCompleteRequestPreview();
          void this.router.navigate(['/onboarding-success'], { queryParamsHandling: 'preserve' });
        },
        error: (error) => {
          this.submissionError =
            error?.error?.message || 'Backend submission failed. Please verify the server and MongoDB connection.';
        },
      });
  }
}

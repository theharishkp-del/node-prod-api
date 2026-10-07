import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AddressPicker, AddressValue } from '../address-picker/address-picker';
import { BranchValue } from '../models/onboarding.models';
import { OnboardingStateService } from '../services/onboarding-state.service';

function addressRequiredValidator(control: AbstractControl): ValidationErrors | null {
  const val: AddressValue = control.value;
  return val?.formattedAddress ? null : { addressRequired: true };
}

@Component({
  selector: 'app-branch-form',
standalone: true,
 imports: [CommonModule, ReactiveFormsModule, AddressPicker],
  templateUrl: './branch-form.html',
  styleUrl: './branch-form.css',
})
export class BranchForm implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly onboardingState = inject(OnboardingStateService);

  form!: FormGroup;

  ngOnInit(): void {
    this.form = this.fb.group({
      branches: this.fb.array([this.createBranchGroup()]),
    });

    const existingValue = this.onboardingState.branches();
    if (existingValue?.length) {
      this.branches.clear();
      existingValue.forEach((branch) => this.branches.push(this.createBranchGroup(branch)));
    }
  }

  get branches(): FormArray<FormGroup> {
    return this.form.get('branches') as FormArray<FormGroup>;
  }

  private createBranchGroup(value?: Partial<BranchValue>): FormGroup {
    return this.fb.group({
      branchId: [value?.branchId ?? ''],
      branchName: [value?.branchName ?? '', Validators.required],
      address: [
        value?.address ?? { formattedAddress: '', lat: null, lng: null },
        addressRequiredValidator,
      ],
    });
  }

  hasError(index: number, name: string, error: string): boolean {
    const c = this.branches.at(index).get(name);
    return !!c && c.touched && c.hasError(error);
  }

  addBranch(): void {
    this.branches.push(this.createBranchGroup());
  }

  removeBranch(index: number): void {
    if (this.branches.length === 1) {
      return;
    }

    this.branches.removeAt(index);
  }

  onNext(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.onboardingState.saveBranches(this.form.getRawValue().branches as BranchValue[]);
    void this.router.navigate(['/cybot-user-registration'], { queryParamsHandling: 'preserve' });
  }

  onReset(): void {
    this.branches.clear();
    this.branches.push(this.createBranchGroup());
  }

  onBack(): void {
    void this.router.navigate(['/company-details'], { queryParamsHandling: 'preserve' });
  }

  onCancel(): void {
    this.onboardingState.resetAll();
    void this.router.navigate(['/company-details'], { queryParamsHandling: 'preserve' });
  }
}

import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { MasterDataFormMode, MasterDataTier } from '../shared/master-data.types';

function uniqueTierKeyValidator(resolveConflict: () => boolean): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value || '').trim();

    if (!value) {
      return null;
    }

    return resolveConflict() ? { duplicateTierKey: true } : null;
  };
}

@Component({
  selector: 'app-tier-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './tier-form.component.html',
  styleUrl: './tier-form.component.css',
})
export class TierFormComponent implements OnChanges {
  @Input() mode: MasterDataFormMode = 'create';
  @Input() tier: MasterDataTier | null = null;
  @Input() existingTiers: MasterDataTier[] = [];
  @Input() saving = false;
  @Input() errorMessage = '';
  @Output() saveRequested = new EventEmitter<Partial<MasterDataTier>>();
  @Output() cancelRequested = new EventEmitter<void>();

  private readonly fb = new FormBuilder();

  readonly form = this.fb.group({
    tierKey: ['', [Validators.required, uniqueTierKeyValidator(() => this.hasDuplicateTierKey())]],
    tierName: ['', Validators.required],
    multiplier: [0, [Validators.required, Validators.min(0)]],
  });

  get isViewMode(): boolean {
    return this.mode === 'view';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tier'] || changes['mode']) {
      this.form.reset({
        tierKey: this.tier?.tierKey ?? '',
        tierName: this.tier?.tierName ?? '',
        multiplier: this.tier?.multiplier ?? 0,
      });
    }

    if (changes['tier'] || changes['mode'] || changes['existingTiers']) {
      this.form.get('tierKey')?.updateValueAndValidity({ emitEvent: false });
    }

    if (changes['mode']) {
      if (this.isViewMode) {
        this.form.disable({ emitEvent: false });
      } else {
        this.form.enable({ emitEvent: false });
      }
    }
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
    this.saveRequested.emit({
      tierKey: String(formValue.tierKey || '').trim().toUpperCase(),
      tierName: String(formValue.tierName || '').trim(),
      multiplier: Number(formValue.multiplier || 0),
    });
  }

  private hasDuplicateTierKey(): boolean {
    const normalizedKey = String(this.form.get('tierKey')?.value || '').trim().toUpperCase();

    if (!normalizedKey) {
      return false;
    }

    return this.existingTiers.some((tier) => (
      tier.id !== this.tier?.id &&
      String(tier.tierKey || '').trim().toUpperCase() === normalizedKey
    ));
  }
}

/**
 * @file Create / edit organization page.
 */
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { map, startWith } from 'rxjs';
import { AdminApi } from '../../core/admin-api.service';
import { applyServerErrors } from '../../core/errors';
import { Organization, OrganizationInput } from '../../core/models';
import { NotifyService } from '../../core/notify.service';

const ORG_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])$/;
const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AED', 'AUD', 'CAD', 'SGD', 'JPY', 'CHF', 'NZD', 'ZAR'];
const TIME_ZONES: string[] = (() => {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const zones = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
  return Array.from(new Set(['Asia/Calcutta', 'Asia/Kolkata', 'UTC', ...zones]));
})();

/** Create / edit an organization (route param `orgId` = edit mode). */
@Component({
  selector: 'app-organization-form',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  templateUrl: './organization-form.html',
})
export class OrganizationForm implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);
  private readonly notify = inject(NotifyService);
  private readonly fb = inject(FormBuilder).nonNullable;

  /** Route param (edit mode). */
  readonly orgId = input<string>();
  protected readonly isEdit = computed(() => Boolean(this.orgId()));
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly org = signal<Organization | null>(null);
  protected readonly currencies = CURRENCIES;

  protected readonly form = this.fb.group({
    orgId: ['', [Validators.pattern(ORG_ID_PATTERN), Validators.maxLength(32)]],
    name: ['', [Validators.required, Validators.maxLength(120)]],
    legalName: ['', [Validators.maxLength(200)]],
    email: ['', [Validators.email, Validators.maxLength(254)]],
    phone: ['', [Validators.maxLength(40)]],
    address: this.fb.group({
      line1: ['', [Validators.maxLength(200)]],
      line2: ['', [Validators.maxLength(200)]],
      city: ['', [Validators.maxLength(100)]],
      state: ['', [Validators.maxLength(100)]],
      postalCode: ['', [Validators.maxLength(20)]],
      country: ['', [Validators.maxLength(100)]],
    }),
    currencyCode: ['USD', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
    timezone: ['Asia/Calcutta', [Validators.required, timeZoneValidator]],
    logoUrl: ['', [Validators.pattern(/^https?:\/\/\S+$/), Validators.maxLength(2048)]],
  });

  protected readonly zoneOptions = toSignal(
    this.form.controls.timezone.valueChanges.pipe(
      startWith(''),
      map((v) => {
        const q = (v || '').toLowerCase();
        return TIME_ZONES.filter((z) => z.toLowerCase().includes(q)).slice(0, 50);
      }),
    ),
    { initialValue: TIME_ZONES.slice(0, 50) },
  );

  ngOnInit(): void {
    const id = this.orgId();
    if (!id) return;
    this.form.controls.orgId.disable();
    this.loading.set(true);
    this.api.getOrganization(id).subscribe({
      next: (org) => {
        this.org.set(org);
        this.form.patchValue({
          orgId: org.orgId,
          name: org.name,
          legalName: org.legalName ?? '',
          email: org.email ?? '',
          phone: org.phone ?? '',
          address: { ...{ line1: '', line2: '', city: '', state: '', postalCode: '', country: '' }, ...org.address },
          currencyCode: org.currencyCode,
          timezone: org.timezone,
          logoUrl: org.logoUrl ?? '',
        });
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.notify.error(err, 'Could not load the organization');
        this.router.navigate(['/organizations']);
      },
    });
  }

  /** First validation message of a control (path like 'address.city'). */
  protected error(path: string): string {
    const c: AbstractControl | null = this.form.get(path);
    if (!c || !c.errors) return '';
    const e = c.errors;
    if (e['server']) return String(e['server']);
    if (e['required']) return 'This field is required';
    if (e['email']) return 'Enter a valid email address';
    if (e['maxlength']) return `At most ${e['maxlength'].requiredLength} characters`;
    if (e['timezone']) return 'Pick a valid IANA time zone';
    if (e['pattern']) {
      if (path === 'orgId') return 'Lowercase letters, digits and "-" (2-32 chars, not at the ends)';
      if (path === 'currencyCode') return '3-letter code, e.g. USD';
      if (path === 'logoUrl') return 'Absolute http(s) URL';
    }
    return 'Invalid value';
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const payload: OrganizationInput = {
      name: v.name.trim(),
      legalName: v.legalName.trim(),
      email: v.email.trim(),
      phone: v.phone.trim(),
      address: Object.fromEntries(Object.entries(v.address).map(([k, val]) => [k, val.trim()])),
      currencyCode: v.currencyCode.trim().toUpperCase(),
      timezone: v.timezone.trim(),
      logoUrl: v.logoUrl.trim(),
    };
    const id = this.orgId();
    if (!id && v.orgId.trim()) payload.orgId = v.orgId.trim();

    this.saving.set(true);
    const request = id ? this.api.updateOrganization(id, payload) : this.api.createOrganization(payload);
    request.subscribe({
      next: (org) => {
        this.saving.set(false);
        this.notify.success(id ? 'Organization updated' : `Organization ${org.name} created (database ${org.dbName})`);
        this.router.navigate(['/organizations', org.orgId]);
      },
      error: (err) => {
        this.saving.set(false);
        applyServerErrors(this.form, err);
        this.notify.error(err, 'Could not save the organization');
      },
    });
  }
}

/** Valid when Intl accepts the time zone. */
function timeZoneValidator(control: AbstractControl): { timezone: true } | null {
  const tz = String(control.value || '');
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return null;
  } catch {
    return { timezone: true };
  }
}

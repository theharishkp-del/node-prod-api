/**
 * @file Create / edit bot page.
 */
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AdminApi } from '../../core/admin-api.service';
import { applyServerErrors } from '../../core/errors';
import { Bot, BotInput, Organization } from '../../core/models';
import { NotifyService } from '../../core/notify.service';

const CHANNELS = ['cybot', 'widget', 'sms', 'ivr', 'mail'];

/** Create / edit a bot (route param `botUserId` = edit mode; ?orgId= preselects the org). */
@Component({
  selector: 'app-bot-form',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  templateUrl: './bot-form.html',
})
export class BotForm implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);
  private readonly notify = inject(NotifyService);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly presetOrg = inject(ActivatedRoute).snapshot.queryParamMap.get('orgId') ?? '';

  /** Route param (edit mode). */
  readonly botUserId = input<string>();
  protected readonly isEdit = computed(() => Boolean(this.botUserId()));
  protected readonly orgs = signal<Organization[]>([]);
  protected readonly bot = signal<Bot | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly channels = CHANNELS;

  protected readonly form = this.fb.group({
    botUserId: ['', [Validators.required, Validators.maxLength(64), Validators.pattern(/^[A-Za-z0-9_.-]+$/)]],
    name: ['', [Validators.required, Validators.maxLength(120)]],
    orgId: [this.presetOrg, [Validators.required]],
    botDatabaseName: ['', [Validators.maxLength(100)]],
    channel: ['cybot', [Validators.maxLength(40)]],
    active: [true],
    config: ['{}', [jsonObjectValidator]],
  });

  ngOnInit(): void {
    this.api.listOrganizations({ sort: 'name', limit: 100 }).subscribe({
      next: ({ items }) => this.orgs.set(items),
      error: (err) => this.notify.error(err, 'Could not load organizations'),
    });
    const id = this.botUserId();
    if (!id) return;
    this.form.controls.botUserId.disable();
    this.loading.set(true);
    this.api.getBot(id).subscribe({
      next: (bot) => {
        this.bot.set(bot);
        this.form.patchValue({
          botUserId: bot.botUserId,
          name: bot.name,
          orgId: bot.orgId,
          botDatabaseName: bot.botDatabaseName ?? '',
          channel: bot.channel,
          active: bot.status === 'active',
          config: JSON.stringify(bot.config ?? {}, null, 2),
        });
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.notify.error(err, 'Could not load the bot');
        this.router.navigate(['/bots']);
      },
    });
  }

  protected error(path: string): string {
    const e = this.form.get(path)?.errors;
    if (!e) return '';
    if (e['server']) return String(e['server']);
    if (e['required']) return 'This field is required';
    if (e['maxlength']) return `At most ${e['maxlength'].requiredLength} characters`;
    if (e['pattern']) return 'Letters, digits, ".", "_" and "-" only';
    if (e['json']) return String(e['json']);
    return 'Invalid value';
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const payload: BotInput = {
      name: v.name.trim(),
      orgId: v.orgId,
      botDatabaseName: v.botDatabaseName.trim(),
      channel: v.channel.trim() || 'cybot',
      config: JSON.parse(v.config || '{}') as Record<string, unknown>,
    };
    const id = this.botUserId();
    this.saving.set(true);

    const request = id
      ? this.api.updateBot(id, payload)
      : this.api.createBot({ ...payload, botUserId: v.botUserId.trim(), status: v.active ? 'active' : 'inactive' });
    request.subscribe({
      next: (bot) => {
        this.saving.set(false);
        this.notify.success(id ? 'Bot updated' : `Bot ${bot.botUserId} created`);
        this.router.navigate(['/organizations', bot.orgId]);
      },
      error: (err) => {
        this.saving.set(false);
        applyServerErrors(this.form, err);
        this.notify.error(err, 'Could not save the bot');
      },
    });
  }
}

/** '' or a JSON object. */
function jsonObjectValidator(control: AbstractControl): ValidationErrors | null {
  const raw = String(control.value ?? '').trim();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? null : { json: 'Must be a JSON object' };
  } catch {
    return { json: 'Invalid JSON' };
  }
}

/**
 * @file Organization detail page: profile, bots and recent EO sessions of the tenant.
 */
import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { AdminApi } from '../../core/admin-api.service';
import { Bot, EoSession, Organization, PageMeta } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { EmptyState } from '../../shared/empty-state';
import { InitialsPipe, SessionDatePipe, TimeAgoPipe } from '../../shared/pipes';
import { StatusChip } from '../../shared/status-chip';
import { BotActions } from '../bots/bot-actions.service';
import { OrganizationActions } from './organization-actions.service';

/** Organization detail: info, its bots and its recent EO sessions. */
@Component({
  selector: 'app-organization-detail',
  imports: [
    RouterLink,
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatTableModule,
    MatTooltipModule,
    StatusChip,
    EmptyState,
    InitialsPipe,
    SessionDatePipe,
    TimeAgoPipe,
  ],
  templateUrl: './organization-detail.html',
  styleUrl: './organization-detail.scss',
})
export class OrganizationDetail implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly notify = inject(NotifyService);
  private readonly orgActions = inject(OrganizationActions);
  private readonly botActions = inject(BotActions);
  protected readonly router = inject(Router);

  readonly orgId = input.required<string>();
  protected readonly org = signal<Organization | null>(null);
  protected readonly bots = signal<Bot[]>([]);
  protected readonly sessions = signal<EoSession[]>([]);
  protected readonly sessionMeta = signal<PageMeta>({ page: 1, limit: 10, total: 0, totalPages: 1 });
  protected readonly loading = signal(true);
  protected readonly loadingSessions = signal(true);
  protected readonly botColumns = ['bot', 'platformDb', 'channel', 'status', 'actions'];
  protected readonly sessionColumns = ['session', 'bot', 'user', 'messages', 'last', 'when'];

  protected readonly address = computed(() => {
    const a = this.org()?.address;
    if (!a) return '';
    return [a.line1, a.line2, [a.city, a.state].filter(Boolean).join(', '), [a.postalCode, a.country].filter(Boolean).join(' ')]
      .filter((x) => x && x.trim())
      .join('\n');
  });

  ngOnInit(): void {
    this.load();
    this.loadSessions(1);
  }

  protected load(): void {
    this.loading.set(true);
    this.api.getOrganization(this.orgId()).subscribe({
      next: (org) => {
        this.org.set(org);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.notify.error(err, 'Could not load the organization');
        this.router.navigate(['/organizations']);
      },
    });
    this.api.listBots({ orgId: this.orgId(), sort: 'name', limit: 100 }).subscribe({
      next: ({ items }) => this.bots.set(items),
      error: (err) => this.notify.error(err, 'Could not load bots'),
    });
  }

  protected loadSessions(page = this.sessionMeta().page, limit = this.sessionMeta().limit): void {
    this.loadingSessions.set(true);
    this.api.listSessions(this.orgId(), { page, limit }).subscribe({
      next: ({ items, meta }) => {
        this.sessions.set(items);
        this.sessionMeta.set(meta);
        this.loadingSessions.set(false);
      },
      error: (err) => {
        this.loadingSessions.set(false);
        this.notify.error(err, 'Could not load sessions');
      },
    });
  }

  protected onSessionPage(e: PageEvent): void {
    this.loadSessions(e.pageIndex + 1, e.pageSize);
  }

  protected toggleStatus(): void {
    const org = this.org();
    if (org) this.orgActions.toggleStatus(org).subscribe((o) => this.org.set({ ...org, ...o }));
  }

  protected remove(): void {
    const org = this.org();
    if (org) this.orgActions.delete(org).subscribe(() => this.router.navigate(['/organizations']));
  }

  protected toggleBot(bot: Bot): void {
    this.botActions.toggleStatus(bot).subscribe(() => this.load());
  }

  protected removeBot(bot: Bot): void {
    this.botActions.delete(bot).subscribe(() => this.load());
  }
}

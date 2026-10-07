/**
 * @file Bots list page with search, organization/status filters and pagination.
 */
import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { AdminApi } from '../../core/admin-api.service';
import { Bot, Organization, PageMeta } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { EmptyState } from '../../shared/empty-state';
import { StatusChip } from '../../shared/status-chip';
import { BotActions } from './bot-actions.service';

/** Bots table with organization / status filters, search and pagination. */
@Component({
  selector: 'app-bot-list',
  imports: [
    RouterLink,
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTableModule,
    StatusChip,
    EmptyState,
  ],
  templateUrl: './bot-list.html',
})
export class BotList implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly notify = inject(NotifyService);
  private readonly actions = inject(BotActions);

  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly orgId = new FormControl(inject(ActivatedRoute).snapshot.queryParamMap.get('orgId') ?? '', {
    nonNullable: true,
  });
  protected readonly status = new FormControl('', { nonNullable: true });
  protected readonly orgs = signal<Organization[]>([]);
  protected readonly items = signal<Bot[]>([]);
  protected readonly meta = signal<PageMeta>({ page: 1, limit: 10, total: 0, totalPages: 1 });
  protected readonly loading = signal(true);
  protected readonly loaded = signal(false);
  protected readonly columns = ['bot', 'organization', 'platformDb', 'channel', 'status', 'updatedAt', 'actions'];

  constructor() {
    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.load(1));
    this.orgId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.load(1));
    this.status.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.load(1));
  }

  ngOnInit(): void {
    this.api.listOrganizations({ sort: 'name', limit: 100 }).subscribe({
      next: ({ items }) => this.orgs.set(items),
      error: (err) => this.notify.error(err, 'Could not load organizations'),
    });
    this.load(1);
  }

  protected load(page = this.meta().page, limit = this.meta().limit): void {
    this.loading.set(true);
    this.api
      .listBots({ q: this.search.value.trim(), orgId: this.orgId.value, status: this.status.value, sort: '-createdAt', page, limit })
      .subscribe({
        next: ({ items, meta }) => {
          this.items.set(items);
          this.meta.set(meta);
          this.loading.set(false);
          this.loaded.set(true);
        },
        error: (err) => {
          this.loading.set(false);
          this.notify.error(err, 'Could not load bots');
        },
      });
  }

  protected onPage(e: PageEvent): void {
    this.load(e.pageIndex + 1, e.pageSize);
  }

  protected clearFilters(): void {
    this.search.setValue('', { emitEvent: false });
    this.orgId.setValue('', { emitEvent: false });
    this.status.setValue('', { emitEvent: false });
    this.load(1);
  }

  protected toggleStatus(bot: Bot): void {
    this.actions.toggleStatus(bot).subscribe(() => this.load());
  }

  protected remove(bot: Bot): void {
    this.actions.delete(bot).subscribe(() => this.load());
  }
}

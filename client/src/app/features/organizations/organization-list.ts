/**
 * @file Organizations list page with search, status filter and pagination.
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
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { AdminApi } from '../../core/admin-api.service';
import { Organization, PageMeta } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { EmptyState } from '../../shared/empty-state';
import { InitialsPipe } from '../../shared/pipes';
import { StatusChip } from '../../shared/status-chip';
import { OrganizationActions } from './organization-actions.service';

/** Organizations table with search, status filter, sorting and server-side pagination. */
@Component({
  selector: 'app-organization-list',
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
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    StatusChip,
    EmptyState,
    InitialsPipe,
  ],
  templateUrl: './organization-list.html',
})
export class OrganizationList implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly notify = inject(NotifyService);
  private readonly actions = inject(OrganizationActions);
  protected readonly router = inject(Router);

  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly status = new FormControl('', { nonNullable: true });
  protected readonly items = signal<Organization[]>([]);
  protected readonly meta = signal<PageMeta>({ page: 1, limit: 10, total: 0, totalPages: 1 });
  protected readonly loading = signal(true);
  protected readonly loaded = signal(false);
  protected readonly columns = ['name', 'contact', 'currency', 'bots', 'status', 'createdAt', 'actions'];
  private sort = '-createdAt';

  constructor() {
    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.load(1));
    this.status.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.load(1));
  }

  ngOnInit(): void {
    this.load(1);
  }

  protected load(page = this.meta().page, limit = this.meta().limit): void {
    this.loading.set(true);
    this.api
      .listOrganizations({ q: this.search.value.trim(), status: this.status.value, sort: this.sort, page, limit })
      .subscribe({
        next: ({ items, meta }) => {
          this.items.set(items);
          this.meta.set(meta);
          this.loading.set(false);
          this.loaded.set(true);
        },
        error: (err) => {
          this.loading.set(false);
          this.notify.error(err, 'Could not load organizations');
        },
      });
  }

  protected onPage(e: PageEvent): void {
    this.load(e.pageIndex + 1, e.pageSize);
  }

  protected onSort(s: Sort): void {
    this.sort = s.direction ? `${s.direction === 'desc' ? '-' : ''}${s.active}` : '-createdAt';
    this.load(1);
  }

  protected clearFilters(): void {
    this.search.setValue('', { emitEvent: false });
    this.status.setValue('', { emitEvent: false });
    this.load(1);
  }

  protected toggleStatus(org: Organization): void {
    this.actions.toggleStatus(org).subscribe(() => this.load());
  }

  protected remove(org: Organization): void {
    this.actions.delete(org).subscribe(() => this.load(this.items().length === 1 && this.meta().page > 1 ? this.meta().page - 1 : this.meta().page));
  }
}

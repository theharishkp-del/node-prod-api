/**
 * @file Dashboard page: stat cards and per-organization activity.
 */
import { DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { AdminApi } from '../../core/admin-api.service';
import { AdminStats } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { EmptyState } from '../../shared/empty-state';
import { InitialsPipe, TimeAgoPipe } from '../../shared/pipes';
import { StatusChip } from '../../shared/status-chip';

/** Dashboard: stat cards + per-organization activity (GET /stats). */
@Component({
  selector: 'app-dashboard',
  imports: [
    RouterLink,
    DecimalPipe,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTableModule,
    MatTooltipModule,
    StatusChip,
    EmptyState,
    TimeAgoPipe,
    InitialsPipe,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly notify = inject(NotifyService);
  protected readonly router = inject(Router);

  protected readonly stats = signal<AdminStats | null>(null);
  protected readonly loading = signal(true);
  protected readonly columns = ['org', 'status', 'bots', 'sessions', 'today', 'last'];

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.api.stats().subscribe({
      next: (s) => {
        this.stats.set(s);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.notify.error(err, 'Could not load statistics');
      },
    });
  }
}

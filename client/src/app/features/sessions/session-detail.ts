/**
 * @file EO session detail page: request details and the chat timeline of a session.
 */
import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { AdminApi } from '../../core/admin-api.service';
import { EoMessage, EoSession } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { EmptyState } from '../../shared/empty-state';
import { SessionDatePipe } from '../../shared/pipes';
import { StatusChip } from '../../shared/status-chip';

interface Segment {
  text: string;
  url?: string;
}

/** Splits text into plain and URL segments (rendered as links without innerHTML). */
function linkify(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /https?:\/\/[^\s<>"']+/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], url: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** One EO session: request metadata + chat-like timeline of inbound/outbound messages. */
@Component({
  selector: 'app-session-detail',
  imports: [
    RouterLink,
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    StatusChip,
    EmptyState,
    SessionDatePipe,
  ],
  templateUrl: './session-detail.html',
  styleUrl: './session-detail.scss',
})
export class SessionDetail implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly notify = inject(NotifyService);
  private readonly router = inject(Router);

  readonly orgId = input.required<string>();
  readonly sessionId = input.required<string>();
  protected readonly session = signal<EoSession | null>(null);
  protected readonly loading = signal(true);
  protected readonly messages = computed(() =>
    (this.session()?.messages ?? []).map((m) => ({ ...m, segments: linkify(m.answerText ?? '') })),
  );

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.api.getSession(this.orgId(), this.sessionId()).subscribe({
      next: (s) => {
        this.session.set(s);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.notify.error(err, 'Could not load the session');
        this.router.navigate(['/organizations', this.orgId()]);
      },
    });
  }

  protected trackMessage(i: number, m: EoMessage): string {
    return `${i}-${m.signalId ?? ''}`;
  }
}

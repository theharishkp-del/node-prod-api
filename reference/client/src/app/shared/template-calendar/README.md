# Reusable calendar template

`TemplateCalendarComponent` owns only calendar presentation and navigation. The consuming feature owns its API service, server response mapping, and event-detail dialog.

## Parent component

```ts
import { Component, inject } from '@angular/core';
import { finalize } from 'rxjs';
import {
  TemplateCalendarBadge,
  TemplateCalendarComponent,
  TemplateCalendarConfig,
  TemplateCalendarEvent,
  TemplateCalendarRange,
} from '../../shared/template-calendar';

@Component({
  selector: 'app-team-calendar',
  standalone: true,
  imports: [TemplateCalendarComponent],
  templateUrl: './team-calendar.component.html',
})
export class TeamCalendarComponent {
  private readonly service = inject(TeamCalendarService);

  readonly calendarConfig: Partial<TemplateCalendarConfig> = {
    eyebrow: 'Support Team',
    heading: 'Support schedule',
    description: 'Upcoming calls, follow-ups, and escalations.',
  };

  events: TemplateCalendarEvent[] = [];
  badges: TemplateCalendarBadge[] = [];
  loading = false;
  errorMessage = '';

  loadRange(range: TemplateCalendarRange): void {
    this.loading = true;
    this.errorMessage = '';

    this.service.getEvents(range.from.toISOString(), range.to.toISOString())
      .pipe(finalize(() => this.loading = false))
      .subscribe({
        next: (response) => {
          this.events = response.items.map((item) => ({
            id: item.id,
            title: item.subject,
            startAt: item.scheduledAt,
            subtitle: item.customerName,
            typeLabel: item.category,
            badge: item.priority,
            tone: item.priority === 'High' ? 'rose' : 'blue',
            metadata: item,
          }));
          this.badges = [
            { id: 'total', label: 'This range', value: response.total, description: 'Support events', tone: 'blue' },
          ];
        },
        error: () => this.errorMessage = 'Unable to load the support calendar.',
      });
  }

  openEvent(event: TemplateCalendarEvent): void {
    // Open the team's dialog or route using event.id/event.metadata.
  }
}
```

## Parent template

```html
<app-template-calendar
  [config]="calendarConfig"
  [events]="events"
  [badges]="badges"
  [loading]="loading"
  [errorMessage]="errorMessage"
  (rangeChange)="loadRange($event)"
  (eventSelected)="openEvent($event)"
/>
```

The server payload does not need to match the template interfaces. Map each team's response to `TemplateCalendarEvent[]` inside that team's parent component or adapter service.

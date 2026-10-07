# Reusable Calendar Template — Usage Guide

## 1. Purpose

The reusable calendar provides the same calendar experience as the Admin Calendar without depending on a specific team, server, or business module.

The component handles:

- Month, week, and day views
- Previous, next, and today navigation
- Calendar headings and descriptions
- Summary badges
- Event cards and status labels
- Loading, refreshing, empty, and error states
- Responsive layout and keyboard navigation

The consuming team handles:

- Calling its server API
- Mapping its server response into the calendar interfaces
- Opening a dialog or route when an event is selected
- Business-specific event details and actions

## 2. Component location

```text
client/src/app/shared/template-calendar/
├── template-calendar.component.ts
├── template-calendar.component.html
├── template-calendar.component.css
├── template-calendar.models.ts
└── index.ts
```

Import the calendar and its interfaces from the directory barrel:

```ts
import {
  TemplateCalendarBadge,
  TemplateCalendarComponent,
  TemplateCalendarConfig,
  TemplateCalendarEvent,
  TemplateCalendarRange,
} from '../../shared/template-calendar';
```

Adjust the relative path based on the consuming component's location.

## 3. Event data contract

Every server event must be mapped to `TemplateCalendarEvent`:

```ts
export interface TemplateCalendarEvent {
  id: string;
  title: string;
  startAt: string | Date;
  subtitle?: string;
  typeLabel?: string;
  status?: string;
  badge?: string;
  tone?: 'cyan' | 'blue' | 'green' | 'amber' | 'rose' | 'violet' | 'slate';
  metadata?: unknown;
}
```

Field usage:

| Field | Required | Purpose |
|---|---:|---|
| `id` | Yes | Unique event identifier |
| `title` | Yes | Main event text |
| `startAt` | Yes | ISO date string or JavaScript `Date` |
| `subtitle` | No | Secondary information, such as a customer name |
| `typeLabel` | No | Event type displayed in the selected-day panel |
| `status` | No | Current event status |
| `badge` | No | Compact label displayed on the event |
| `tone` | No | Supported visual colour |
| `metadata` | No | Original API record used by the parent component |

Do not change the shared component when a team has a different server payload. Map that payload in the team's parent component or adapter service.

## 4. Summary badge contract

```ts
export interface TemplateCalendarBadge {
  id: string;
  label: string;
  value: string | number;
  description?: string;
  tone?: 'cyan' | 'blue' | 'green' | 'amber' | 'rose' | 'violet' | 'slate';
}
```

Example:

```ts
badges: TemplateCalendarBadge[] = [
  {
    id: 'meetings',
    label: 'This range',
    value: 12,
    description: 'Customer meetings',
    tone: 'blue',
  },
  {
    id: 'urgent',
    label: 'This range',
    value: 3,
    description: 'Urgent events',
    tone: 'rose',
  },
];
```

## 5. Create a team calendar component

Generate or create a standalone parent component. The parent owns the API request and passes normalized data to the shared calendar.

```ts
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject } from '@angular/core';
import { finalize } from 'rxjs';
import {
  TemplateCalendarBadge,
  TemplateCalendarComponent,
  TemplateCalendarConfig,
  TemplateCalendarEvent,
  TemplateCalendarRange,
} from '../../shared/template-calendar';
import { SupportCalendarService } from './support-calendar.service';

@Component({
  selector: 'app-support-calendar',
  standalone: true,
  imports: [TemplateCalendarComponent],
  templateUrl: './support-calendar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportCalendarComponent {
  private readonly service = inject(SupportCalendarService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  readonly config: Partial<TemplateCalendarConfig> = {
    eyebrow: 'Support Team',
    heading: 'Support schedule',
    description: 'Review customer calls, follow-ups, and escalations.',
    selectedDayEyebrow: 'Selected schedule',
    maxEventsPerDay: 3,
    enabledViews: ['month', 'week', 'day'],
  };

  events: TemplateCalendarEvent[] = [];
  badges: TemplateCalendarBadge[] = [];
  loading = false;
  refreshing = false;
  errorMessage = '';

  loadRange(range: TemplateCalendarRange): void {
    const hasExistingData = this.events.length > 0;
    this.loading = !hasExistingData;
    this.refreshing = hasExistingData;
    this.errorMessage = '';

    this.service.getEvents(range.from.toISOString(), range.to.toISOString())
      .pipe(finalize(() => {
        this.loading = false;
        this.refreshing = false;
        this.changeDetectorRef.markForCheck();
      }))
      .subscribe({
        next: (response) => {
          this.events = response.items.map((item) => ({
            id: item.id,
            title: item.subject,
            startAt: item.scheduledAt,
            subtitle: item.customerName,
            typeLabel: item.category,
            status: item.status,
            badge: item.priority,
            tone: item.priority === 'high' ? 'rose' : 'blue',
            metadata: item,
          }));

          this.badges = [
            {
              id: 'total',
              label: 'This range',
              value: response.total,
              description: 'Support events',
              tone: 'blue',
            },
          ];

          this.changeDetectorRef.markForCheck();
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Unable to load the support calendar.';
          this.changeDetectorRef.markForCheck();
        },
      });
  }

  openEvent(event: TemplateCalendarEvent): void {
    const originalRecord = event.metadata;
    // Open the team's dialog or navigate using event.id/originalRecord.
  }
}
```

## 6. Parent HTML template

```html
<app-template-calendar
  [config]="config"
  [events]="events"
  [badges]="badges"
  [loading]="loading"
  [refreshing]="refreshing"
  [errorMessage]="errorMessage"
  (rangeChange)="loadRange($event)"
  (eventSelected)="openEvent($event)"
/>
```

When the component opens or the user changes the period, `rangeChange` provides the required server range:

```ts
export interface TemplateCalendarRange {
  view: 'month' | 'week' | 'day';
  anchorDate: Date;
  from: Date;
  to: Date;
}
```

## 7. Inputs

| Input | Type | Description |
|---|---|---|
| `config` | `Partial<TemplateCalendarConfig>` | Heading, labels, view options, and display limits |
| `events` | `TemplateCalendarEvent[]` | Normalized server events |
| `badges` | `TemplateCalendarBadge[]` | Dynamic summary badges |
| `loading` | `boolean` | Initial loading state |
| `refreshing` | `boolean` | Loading state when existing calendar data is visible |
| `errorMessage` | `string` | API or validation error displayed by the calendar |
| `initialDate` | `string \| Date` | Initial calendar date |
| `initialView` | `'month' \| 'week' \| 'day'` | Initial view mode |

## 8. Outputs

| Output | Payload | When emitted |
|---|---|---|
| `rangeChange` | `TemplateCalendarRange` | Initial load, navigation, today, or view change |
| `viewChange` | `'month' \| 'week' \| 'day'` | View selection changes |
| `dateSelected` | `{ date, isoDate }` | Calendar date is selected |
| `eventSelected` | `TemplateCalendarEvent` | Event card is selected |

## 9. Localhost Admin Calendar example

A working integration example is available at:

```text
client/src/app/features/template-calendar-test/
```

The example maps this endpoint:

```http
GET http://localhost:3002/web/v1/master-data/calendar/events?from=<ISO_DATE>&to=<ISO_DATE>
```

Local mode is configured in:

```text
client/src/environments/environment.local.ts
```

with:

```ts
baseUrl: 'http://localhost:3002'
```

## 10. Run locally

Open two terminals.

Terminal 1 — Express API:

```bash
cd server
npm start
```

Terminal 2 — Angular application:

```bash
cd client
npm start -- --configuration local --host 127.0.0.1
```

Open:

```text
http://127.0.0.1:4200/template-calendar-test?key=<encoded-bot-key>
```

The existing application requires the encoded bot key to resolve the tenant. Without a valid key, the application redirects to the missing-key screen and the server rejects calendar requests without an `x-bot-user-id` header.

## 11. Test the localhost API

With the Express server running:

```bash
cd server
npm run test:calendar-api
```

The smoke test:

1. Reads one active tenant from the local master database.
2. Calls the real calendar endpoint for the current month.
3. Verifies the HTTP response.
4. Prints the range, summary counts, event count, and event types.
5. Does not print tenant credentials.

An empty event list is valid when the tenant has no events in the selected month.

## 12. Build verification

Run the local configuration build:

```bash
cd client
npm run build -- --configuration local
```

Run the production build:

```bash
cd client
npm run build
```

## 13. Team integration checklist

- Import `TemplateCalendarComponent` into a standalone parent component.
- Keep API calls inside the team service or parent component.
- Map every response item to `TemplateCalendarEvent`.
- Store the original record in `metadata` when event details are required.
- Update badges after every range response.
- Handle `rangeChange` to request the correct server period.
- Handle `eventSelected` to open the team's dialog or page.
- Pass loading, refreshing, and error states to the calendar.
- Verify month, week, and day navigation.
- Test desktop and mobile layouts.
- Do not add team-specific fields or services to the shared component.

## 14. Reference implementation

Use the following files as the working reference:

- `client/src/app/features/template-calendar-test/template-calendar-test.component.ts`
- `client/src/app/features/template-calendar-test/template-calendar-test.component.html`
- `server/scripts/calendarApiSmokeTest.js`

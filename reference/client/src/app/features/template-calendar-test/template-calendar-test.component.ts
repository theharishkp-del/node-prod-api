import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject } from '@angular/core';
import { finalize } from 'rxjs';
import { AdminCalendarService } from '../master-data/admin-calendar/admin-calendar.service';
import { AdminCalendarEvent } from '../master-data/shared/master-data.types';
import {
  TemplateCalendarBadge,
  TemplateCalendarComponent,
  TemplateCalendarConfig,
  TemplateCalendarEvent,
  TemplateCalendarRange,
} from '../../shared/template-calendar';

@Component({
  selector: 'app-template-calendar-test',
  standalone: true,
  imports: [CommonModule, TemplateCalendarComponent],
  templateUrl: './template-calendar-test.component.html',
  styleUrl: './template-calendar-test.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplateCalendarTestComponent {
  private readonly calendarService = inject(AdminCalendarService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  protected readonly calendarConfig: Partial<TemplateCalendarConfig> = {
    eyebrow: 'Reusable Calendar Template',
    heading: 'Local API payload test',
    description: 'This page maps the existing localhost Admin Calendar response into the shared calendar contract.',
    selectedDayEyebrow: 'API events',
    loadingMessage: 'Loading events from localhost:3002...',
  };

  protected events: TemplateCalendarEvent[] = [];
  protected badges: TemplateCalendarBadge[] = [];
  protected loading = false;
  protected refreshing = false;
  protected errorMessage = '';
  protected selectedEvent: TemplateCalendarEvent | null = null;
  protected lastRange: TemplateCalendarRange | null = null;

  protected loadRange(range: TemplateCalendarRange): void {
    const hasData = this.events.length > 0;
    this.loading = !hasData;
    this.refreshing = hasData;
    this.errorMessage = '';
    this.lastRange = range;

    this.calendarService.getEvents(range.from.toISOString(), range.to.toISOString())
      .pipe(finalize(() => {
        this.loading = false;
        this.refreshing = false;
        this.changeDetectorRef.markForCheck();
      }))
      .subscribe({
        next: (response) => {
          const payload = response?.data;
          const apiEvents = Array.isArray(payload?.events) ? payload.events : [];
          this.events = apiEvents.map((event) => this.mapEvent(event));
          this.badges = [
            {
              id: 'enquiries',
              label: 'This range',
              value: payload?.summary?.totalEnquiries ?? 0,
              description: 'Customer enquiries',
              tone: 'cyan',
            },
            {
              id: 'conversions',
              label: 'This range',
              value: payload?.summary?.totalConversions ?? 0,
              description: 'Work order conversions',
              tone: 'blue',
            },
          ];
          this.changeDetectorRef.markForCheck();
        },
        error: (error) => {
          this.events = [];
          this.badges = [];
          this.errorMessage = error?.error?.message
            || 'Unable to load localhost calendar data. Confirm the server is running and the bot tenant key is valid.';
          this.changeDetectorRef.markForCheck();
        },
      });
  }

  protected showEventPayload(event: TemplateCalendarEvent): void {
    this.selectedEvent = event;
  }

  protected closePayload(): void {
    this.selectedEvent = null;
  }

  private mapEvent(event: AdminCalendarEvent): TemplateCalendarEvent {
    const isConversion = event.eventType === 'work_order_conversion';
    return {
      id: event.id,
      title: isConversion
        ? (event.orderReferenceNumber || event.title || 'Work order')
        : (event.title || 'Customer enquiry'),
      startAt: event.startAt || new Date(),
      subtitle: event.subtitle || undefined,
      typeLabel: isConversion ? 'Work Order Conversion' : 'Customer Enquiry',
      status: event.status || (isConversion ? 'open' : 'active'),
      badge: isConversion ? 'Order' : 'Enquiry',
      tone: isConversion ? 'blue' : 'cyan',
      metadata: event,
    };
  }
}

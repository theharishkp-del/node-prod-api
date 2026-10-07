import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { finalize } from 'rxjs';
import { AdminCalendarService } from './admin-calendar.service';
import {
  AdminCalendarEvent,
  AdminCalendarResponse,
  AdminCalendarWorkOrderDetails,
} from '../shared/master-data.types';

type CalendarViewMode = 'month' | 'week' | 'day';

interface CalendarDayCell {
  isoDate: string;
  date: Date;
  inCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  events: AdminCalendarEvent[];
}

@Component({
  selector: 'app-admin-calendar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-calendar.component.html',
  styleUrl: './admin-calendar.component.css',
})
export class AdminCalendarComponent implements OnInit {
  private readonly adminCalendarService = inject(AdminCalendarService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  @ViewChild('eventsPanel') private eventsPanelRef?: ElementRef<HTMLElement>;

  protected viewMode: CalendarViewMode = 'month';
  protected currentDate = new Date();
  protected selectedDateIso = this.toIsoDate(new Date());
  protected loading = false;
  protected refreshing = false;
  protected detailsLoading = false;
  protected errorMessage = '';
  protected calendarResponse: AdminCalendarResponse | null = null;
  protected events: AdminCalendarEvent[] = [];
  protected calendarDays: CalendarDayCell[] = [];
  protected selectedEvent: AdminCalendarEvent | null = null;
  protected selectedWorkOrderDetails: AdminCalendarWorkOrderDetails | null = null;
  protected workOrderDetailsError = '';

  ngOnInit(): void {
    this.loadCalendar();
  }

  protected setViewMode(viewMode: CalendarViewMode): void {
    this.viewMode = viewMode;
    this.loadCalendar();
  }

  protected previousPeriod(): void {
    if (this.loading || this.refreshing) {
      console.log('[AdminCalendarComponent] Previous click ignored while loading', {
        viewMode: this.viewMode,
        currentDate: this.currentDate.toISOString(),
      });
      return;
    }

    const nextDate = new Date(this.currentDate);

    if (this.viewMode === 'month') {
      nextDate.setMonth(nextDate.getMonth() - 1);
    } else if (this.viewMode === 'week') {
      nextDate.setDate(nextDate.getDate() - 7);
    } else {
      nextDate.setDate(nextDate.getDate() - 1);
    }

    this.currentDate = nextDate;
    console.log('[AdminCalendarComponent] Previous period selected', {
      viewMode: this.viewMode,
      currentDate: this.currentDate.toISOString(),
      rangeLabel: this.getRangeLabel(),
    });
    this.loadCalendar();
  }

  protected nextPeriod(): void {
    if (this.loading || this.refreshing) {
      console.log('[AdminCalendarComponent] Next click ignored while loading', {
        viewMode: this.viewMode,
        currentDate: this.currentDate.toISOString(),
      });
      return;
    }

    const nextDate = new Date(this.currentDate);

    if (this.viewMode === 'month') {
      nextDate.setMonth(nextDate.getMonth() + 1);
    } else if (this.viewMode === 'week') {
      nextDate.setDate(nextDate.getDate() + 7);
    } else {
      nextDate.setDate(nextDate.getDate() + 1);
    }

    this.currentDate = nextDate;
    console.log('[AdminCalendarComponent] Next period selected', {
      viewMode: this.viewMode,
      currentDate: this.currentDate.toISOString(),
      rangeLabel: this.getRangeLabel(),
    });
    this.loadCalendar();
  }

  protected jumpToToday(): void {
    this.currentDate = new Date();
    this.selectedDateIso = this.toIsoDate(new Date());
    this.loadCalendar();
  }

  protected selectDay(day: CalendarDayCell): void {
    this.selectedDateIso = day.isoDate;
    this.buildCalendarDays();
    this.scrollToEventsPanelIfNeeded();
  }

  protected openEvent(event: AdminCalendarEvent): void {
    this.selectedEvent = event;
    this.selectedWorkOrderDetails = null;
    this.workOrderDetailsError = '';

    if (event.eventType !== 'work_order_conversion' || !event.entityId) {
      this.changeDetectorRef.detectChanges();
      return;
    }

    this.detailsLoading = true;
    this.adminCalendarService.getWorkOrderDetails(event.entityId)
      .pipe(finalize(() => {
        this.detailsLoading = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.selectedWorkOrderDetails = response?.data || null;
          this.workOrderDetailsError = this.selectedWorkOrderDetails ? '' : 'Work order details are not available.';
        },
        error: (error) => {
          this.selectedWorkOrderDetails = null;
          this.workOrderDetailsError = error?.error?.message || 'Unable to load work order details.';
        },
      });
  }

  protected closeDialog(): void {
    this.selectedEvent = null;
    this.selectedWorkOrderDetails = null;
    this.detailsLoading = false;
    this.workOrderDetailsError = '';
  }

  protected getVisibleEvents(): AdminCalendarEvent[] {
    if (this.viewMode === 'week') {
      const weekDays = this.getWeekDays(this.currentDate).map((date) => this.toIsoDate(date));
      const weekDaySet = new Set(weekDays);
      return this.events.filter((event) => weekDaySet.has(this.toIsoDate(event.startAt || new Date())));
    }

    return this.getSelectedDayEvents();
  }

  protected getSelectedDayEvents(): AdminCalendarEvent[] {
    return this.events.filter((event) => this.toIsoDate(event.startAt || new Date()) === this.selectedDateIso);
  }

  protected getDayEventCountLabel(day: CalendarDayCell): string {
    if (!day.events.length) {
      return 'No events';
    }

    if (day.events.length === 1) {
      return '1 event';
    }

    return `${day.events.length} events`;
  }

  protected getRangeLabel(): string {
    if (this.viewMode === 'month') {
      return this.currentDate.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    }

    if (this.viewMode === 'week') {
      const weekDays = this.getWeekDays(this.currentDate);
      const firstDay = weekDays[0];
      const lastDay = weekDays[6];
      return `${firstDay.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${lastDay.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }

    return this.currentDate.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }

  protected getDayLabel(day: CalendarDayCell): string {
    return day.date.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
    });
  }

  protected getEventClass(event: AdminCalendarEvent): string {
    return event.eventType === 'work_order_conversion'
      ? 'calendar-event calendar-event-conversion'
      : 'calendar-event calendar-event-enquiry';
  }

  protected getEventTypeLabel(event: AdminCalendarEvent): string {
    return event.eventType === 'work_order_conversion' ? 'Work Order Conversion' : 'Customer Enquiry';
  }

  protected getCompactEventLabel(event: AdminCalendarEvent): string {
    return event.eventType === 'work_order_conversion'
      ? (event.orderReferenceNumber || event.title || 'Work order')
      : (event.title || 'Enquiry');
  }

  protected getEventStatusLabel(event: AdminCalendarEvent): string {
    return event.status || (event.eventType === 'work_order_conversion' ? 'open' : 'active');
  }

  private loadCalendar(): void {
    const hasExistingCalendar = this.calendarDays.length > 0 || this.events.length > 0 || !!this.calendarResponse;

    this.loading = !hasExistingCalendar;
    this.refreshing = hasExistingCalendar;
    this.errorMessage = '';
    const { from, to } = this.getRangeBounds();

    console.log('[AdminCalendarComponent] Load calendar start', {
      viewMode: this.viewMode,
      currentDate: this.currentDate.toISOString(),
      from: from.toISOString(),
      to: to.toISOString(),
      hasExistingCalendar,
    });

    this.adminCalendarService.getEvents(from.toISOString(), to.toISOString())
      .pipe(finalize(() => {
        console.log('[AdminCalendarComponent] Load calendar finalize', {
          viewMode: this.viewMode,
          currentDate: this.currentDate.toISOString(),
          loadingBeforeFinalize: this.loading,
          refreshingBeforeFinalize: this.refreshing,
          errorMessage: this.errorMessage,
          eventCount: this.events.length,
          dayCount: this.calendarDays.length,
        });
        this.loading = false;
        this.refreshing = false;
        this.changeDetectorRef.detectChanges();
      }))
      .subscribe({
        next: (response) => {
          this.calendarResponse = response?.data || null;
          this.events = Array.isArray(response?.data?.events) ? response.data.events : [];
          console.log('[AdminCalendarComponent] Load calendar success', {
            viewMode: this.viewMode,
            currentDate: this.currentDate.toISOString(),
            eventCount: this.events.length,
            summary: this.calendarResponse?.summary || null,
          });
          this.ensureSelectedDateInView();
          this.buildCalendarDays();
        },
        error: (error) => {
          this.errorMessage = error?.error?.message || 'Failed to load admin calendar.';
          console.error('[AdminCalendarComponent] Load calendar failed', {
            viewMode: this.viewMode,
            currentDate: this.currentDate.toISOString(),
            error,
            errorMessage: this.errorMessage,
          });
        },
      });
  }

  private buildCalendarDays(): void {
    if (this.viewMode === 'week') {
      this.calendarDays = this.getWeekDays(this.currentDate).map((date) => this.buildDayCell(date, true));
      return;
    }

    if (this.viewMode === 'day') {
      this.calendarDays = [this.buildDayCell(this.currentDate, true)];
      return;
    }

    const startOfMonth = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
    const endOfMonth = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 0);
    const gridStart = new Date(startOfMonth);
    gridStart.setDate(startOfMonth.getDate() - startOfMonth.getDay());
    const gridEnd = new Date(endOfMonth);
    gridEnd.setDate(endOfMonth.getDate() + (6 - endOfMonth.getDay()));

    const days: CalendarDayCell[] = [];
    const cursor = new Date(gridStart);

    while (cursor <= gridEnd) {
      days.push(this.buildDayCell(cursor, cursor.getMonth() === this.currentDate.getMonth()));
      cursor.setDate(cursor.getDate() + 1);
    }

    this.calendarDays = days;
  }

  private ensureSelectedDateInView(): void {
    const selectedDate = new Date(this.selectedDateIso || this.currentDate);

    if (Number.isNaN(selectedDate.getTime())) {
      this.selectedDateIso = this.toIsoDate(this.currentDate);
      return;
    }

    if (this.viewMode === 'month') {
      const sameMonth = selectedDate.getFullYear() === this.currentDate.getFullYear()
        && selectedDate.getMonth() === this.currentDate.getMonth();

      if (!sameMonth) {
        this.selectedDateIso = this.toIsoDate(this.currentDate);
      }

      return;
    }

    if (this.viewMode === 'week') {
      const weekDaySet = new Set(this.getWeekDays(this.currentDate).map((date) => this.toIsoDate(date)));

      if (!weekDaySet.has(this.selectedDateIso)) {
        this.selectedDateIso = this.toIsoDate(this.currentDate);
      }

      return;
    }

    this.selectedDateIso = this.toIsoDate(this.currentDate);
  }

  private buildDayCell(dateInput: Date, inCurrentMonth: boolean): CalendarDayCell {
    const date = new Date(dateInput);
    const isoDate = this.toIsoDate(date);
    const dayEvents = this.events.filter((event) => this.toIsoDate(event.startAt || new Date()) === isoDate);

    return {
      isoDate,
      date,
      inCurrentMonth,
      isToday: isoDate === this.toIsoDate(new Date()),
      isSelected: isoDate === this.selectedDateIso,
      events: dayEvents,
    };
  }

  private scrollToEventsPanelIfNeeded(): void {
    if (!this.getSelectedDayEvents().length || typeof window === 'undefined') {
      return;
    }

    window.requestAnimationFrame(() => {
      this.eventsPanelRef?.nativeElement?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  private getRangeBounds(): { from: Date; to: Date } {
    if (this.viewMode === 'week') {
      const weekDays = this.getWeekDays(this.currentDate);
      const from = new Date(weekDays[0]);
      from.setHours(0, 0, 0, 0);
      const to = new Date(weekDays[6]);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }

    if (this.viewMode === 'day') {
      const from = new Date(this.currentDate);
      from.setHours(0, 0, 0, 0);
      const to = new Date(this.currentDate);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }

    const from = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
    from.setHours(0, 0, 0, 0);
    const to = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 0);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }

  private getWeekDays(dateInput: Date): Date[] {
    const anchor = new Date(dateInput);
    const start = new Date(anchor);
    start.setDate(anchor.getDate() - anchor.getDay());
    start.setHours(0, 0, 0, 0);

    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }

  private toIsoDate(value: string | Date): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
}

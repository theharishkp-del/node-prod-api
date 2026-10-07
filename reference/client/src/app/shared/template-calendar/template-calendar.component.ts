import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import {
  TemplateCalendarBadge,
  TemplateCalendarConfig,
  TemplateCalendarDateSelection,
  TemplateCalendarEvent,
  TemplateCalendarRange,
  TemplateCalendarTone,
  TemplateCalendarView,
} from './template-calendar.models';

interface TemplateCalendarDay {
  isoDate: string;
  date: Date;
  inCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  events: readonly TemplateCalendarEvent[];
}

const DEFAULT_CONFIG: TemplateCalendarConfig = {
  eyebrow: 'Team Calendar',
  heading: 'Calendar overview',
  description: 'Review scheduled events for the selected period.',
  selectedDayEyebrow: 'Selected day',
  todayButtonLabel: 'Today',
  emptyStateMessage: 'No events for this selection.',
  loadingMessage: 'Loading calendar...',
  maxEventsPerDay: 3,
  enabledViews: ['month', 'week', 'day'],
};

@Component({
  selector: 'app-template-calendar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './template-calendar.component.html',
  styleUrl: './template-calendar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplateCalendarComponent implements OnInit {
  @ViewChild('eventsPanel') private eventsPanelRef?: ElementRef<HTMLElement>;

  @Input() loading = false;
  @Input() refreshing = false;
  @Input() errorMessage = '';
  @Input() badges: readonly TemplateCalendarBadge[] = [];

  @Input()
  set config(value: Partial<TemplateCalendarConfig> | null | undefined) {
    this.resolvedConfig = {
      ...DEFAULT_CONFIG,
      ...value,
      enabledViews: value?.enabledViews?.length ? value.enabledViews : DEFAULT_CONFIG.enabledViews,
      maxEventsPerDay: Math.max(1, value?.maxEventsPerDay ?? DEFAULT_CONFIG.maxEventsPerDay),
    };

    if (!this.resolvedConfig.enabledViews.includes(this.viewMode)) {
      this.viewMode = this.resolvedConfig.enabledViews[0] ?? 'month';
    }
    this.buildCalendarDays();
  }

  @Input()
  set events(value: readonly TemplateCalendarEvent[] | null | undefined) {
    this.calendarEvents = (value ?? []).filter((event) => this.isValidDate(event.startAt));
    this.buildCalendarDays();
  }

  @Input()
  set initialDate(value: string | Date | null | undefined) {
    if (!value || !this.isValidDate(value)) {
      return;
    }
    this.currentDate = new Date(value);
    this.selectedDateIso = this.toIsoDate(this.currentDate);
    this.buildCalendarDays();
  }

  @Input()
  set initialView(value: TemplateCalendarView) {
    if (value) {
      this.viewMode = value;
      this.buildCalendarDays();
    }
  }

  @Output() readonly rangeChange = new EventEmitter<TemplateCalendarRange>();
  @Output() readonly viewChange = new EventEmitter<TemplateCalendarView>();
  @Output() readonly dateSelected = new EventEmitter<TemplateCalendarDateSelection>();
  @Output() readonly eventSelected = new EventEmitter<TemplateCalendarEvent>();

  protected resolvedConfig: TemplateCalendarConfig = { ...DEFAULT_CONFIG };
  protected viewMode: TemplateCalendarView = 'month';
  protected currentDate = new Date();
  protected selectedDateIso = this.toIsoDate(new Date());
  protected calendarEvents: readonly TemplateCalendarEvent[] = [];
  protected calendarDays: readonly TemplateCalendarDay[] = [];

  ngOnInit(): void {
    this.ensureSelectedDateInView();
    this.buildCalendarDays();
    this.emitRangeChange();
  }

  protected setViewMode(view: TemplateCalendarView): void {
    if (view === this.viewMode || !this.resolvedConfig.enabledViews.includes(view)) {
      return;
    }
    this.viewMode = view;
    this.ensureSelectedDateInView();
    this.buildCalendarDays();
    this.viewChange.emit(view);
    this.emitRangeChange();
  }

  protected movePeriod(direction: -1 | 1): void {
    if (this.loading || this.refreshing) {
      return;
    }

    const nextDate = new Date(this.currentDate);
    if (this.viewMode === 'month') {
      nextDate.setMonth(nextDate.getMonth() + direction);
    } else if (this.viewMode === 'week') {
      nextDate.setDate(nextDate.getDate() + (7 * direction));
    } else {
      nextDate.setDate(nextDate.getDate() + direction);
    }

    this.currentDate = nextDate;
    this.ensureSelectedDateInView();
    this.buildCalendarDays();
    this.emitRangeChange();
  }

  protected jumpToToday(): void {
    this.currentDate = new Date();
    this.selectedDateIso = this.toIsoDate(this.currentDate);
    this.buildCalendarDays();
    this.emitDateSelection(this.currentDate);
    this.emitRangeChange();
  }

  protected selectDay(day: TemplateCalendarDay): void {
    this.selectedDateIso = day.isoDate;
    this.buildCalendarDays();
    this.emitDateSelection(day.date);

    if (day.events.length && typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        this.eventsPanelRef?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  protected selectEvent(event: TemplateCalendarEvent, domEvent?: Event): void {
    domEvent?.stopPropagation();
    this.eventSelected.emit(event);
  }

  protected getVisibleEvents(): readonly TemplateCalendarEvent[] {
    if (this.viewMode === 'week') {
      const dates = new Set(this.getWeekDays(this.currentDate).map((date) => this.toIsoDate(date)));
      return this.calendarEvents.filter((event) => dates.has(this.toIsoDate(event.startAt)));
    }
    return this.getSelectedDayEvents();
  }

  protected getSelectedDayEvents(): readonly TemplateCalendarEvent[] {
    return this.calendarEvents.filter((event) => this.toIsoDate(event.startAt) === this.selectedDateIso);
  }

  protected getRangeLabel(): string {
    if (this.viewMode === 'month') {
      return this.currentDate.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    }
    if (this.viewMode === 'week') {
      const days = this.getWeekDays(this.currentDate);
      return `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    return this.currentDate.toLocaleDateString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  }

  protected getDayLabel(day: TemplateCalendarDay): string {
    return day.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  }

  protected getEventCountLabel(count: number): string {
    return count === 1 ? '1 event' : `${count} events`;
  }

  protected getToneClass(tone: TemplateCalendarTone | undefined): string {
    return `tone-${tone ?? 'cyan'}`;
  }

  protected trackById(_index: number, item: TemplateCalendarEvent | TemplateCalendarBadge): string {
    return item.id;
  }

  protected trackDay(_index: number, day: TemplateCalendarDay): string {
    return day.isoDate;
  }

  private buildCalendarDays(): void {
    if (this.viewMode === 'week') {
      this.calendarDays = this.getWeekDays(this.currentDate).map((date) => this.buildDay(date, true));
      return;
    }
    if (this.viewMode === 'day') {
      this.calendarDays = [this.buildDay(this.currentDate, true)];
      return;
    }

    const monthStart = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
    const monthEnd = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 0);
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - monthStart.getDay());
    const gridEnd = new Date(monthEnd);
    gridEnd.setDate(monthEnd.getDate() + (6 - monthEnd.getDay()));

    const days: TemplateCalendarDay[] = [];
    const cursor = new Date(gridStart);
    while (cursor <= gridEnd) {
      days.push(this.buildDay(cursor, cursor.getMonth() === this.currentDate.getMonth()));
      cursor.setDate(cursor.getDate() + 1);
    }
    this.calendarDays = days;
  }

  private buildDay(dateInput: Date, inCurrentMonth: boolean): TemplateCalendarDay {
    const date = new Date(dateInput);
    const isoDate = this.toIsoDate(date);
    return {
      date,
      isoDate,
      inCurrentMonth,
      isToday: isoDate === this.toIsoDate(new Date()),
      isSelected: isoDate === this.selectedDateIso,
      events: this.calendarEvents.filter((event) => this.toIsoDate(event.startAt) === isoDate),
    };
  }

  private ensureSelectedDateInView(): void {
    const visibleDates = this.viewMode === 'month'
      ? null
      : new Set((this.viewMode === 'week' ? this.getWeekDays(this.currentDate) : [this.currentDate]).map((date) => this.toIsoDate(date)));
    const selected = new Date(`${this.selectedDateIso}T00:00:00`);
    const inMonth = selected.getFullYear() === this.currentDate.getFullYear()
      && selected.getMonth() === this.currentDate.getMonth();

    if ((this.viewMode === 'month' && !inMonth) || (visibleDates && !visibleDates.has(this.selectedDateIso))) {
      this.selectedDateIso = this.toIsoDate(this.currentDate);
    }
  }

  private emitDateSelection(date: Date): void {
    this.dateSelected.emit({ date: new Date(date), isoDate: this.toIsoDate(date) });
  }

  private emitRangeChange(): void {
    const { from, to } = this.getRangeBounds();
    this.rangeChange.emit({
      view: this.viewMode,
      anchorDate: new Date(this.currentDate),
      from,
      to,
    });
  }

  private getRangeBounds(): { from: Date; to: Date } {
    if (this.viewMode === 'week') {
      const days = this.getWeekDays(this.currentDate);
      return { from: this.startOfDay(days[0]), to: this.endOfDay(days[6]) };
    }
    if (this.viewMode === 'day') {
      return { from: this.startOfDay(this.currentDate), to: this.endOfDay(this.currentDate) };
    }
    return {
      from: this.startOfDay(new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1)),
      to: this.endOfDay(new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 0)),
    };
  }

  private getWeekDays(dateInput: Date): Date[] {
    const start = this.startOfDay(dateInput);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }

  private startOfDay(value: Date): Date {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private endOfDay(value: Date): Date {
    const date = new Date(value);
    date.setHours(23, 59, 59, 999);
    return date;
  }

  private isValidDate(value: string | Date): boolean {
    return !Number.isNaN(new Date(value).getTime());
  }

  private toIsoDate(value: string | Date): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
}

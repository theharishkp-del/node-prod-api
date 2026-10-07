export type TemplateCalendarView = 'month' | 'week' | 'day';

export type TemplateCalendarTone =
  | 'cyan'
  | 'blue'
  | 'green'
  | 'amber'
  | 'rose'
  | 'violet'
  | 'slate';

export interface TemplateCalendarEvent {
  id: string;
  title: string;
  startAt: string | Date;
  subtitle?: string;
  typeLabel?: string;
  status?: string;
  badge?: string;
  tone?: TemplateCalendarTone;
  metadata?: unknown;
}

export interface TemplateCalendarBadge {
  id: string;
  label: string;
  value: string | number;
  description?: string;
  tone?: TemplateCalendarTone;
}

export interface TemplateCalendarConfig {
  eyebrow: string;
  heading: string;
  description: string;
  selectedDayEyebrow: string;
  todayButtonLabel: string;
  emptyStateMessage: string;
  loadingMessage: string;
  maxEventsPerDay: number;
  enabledViews: readonly TemplateCalendarView[];
}

export interface TemplateCalendarRange {
  view: TemplateCalendarView;
  anchorDate: Date;
  from: Date;
  to: Date;
}

export interface TemplateCalendarDateSelection {
  date: Date;
  isoDate: string;
}

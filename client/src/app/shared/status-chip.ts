/**
 * @file Coloured status chip (active / suspended / inactive ...).
 */
import { Component, computed, input } from '@angular/core';

const TONES: Record<string, string> = {
  active: 'success',
  suspended: 'danger',
  inactive: 'warn',
  stop: 'info',
  continue: 'teal',
};

/** Colored status pill (active / suspended / inactive / eoState ...). */
@Component({
  selector: 'app-status-chip',
  template: `<span class="chip" [class]="'chip ' + tone()">{{ label() || status() }}</span>`,
})
export class StatusChip {
  readonly status = input.required<string>();
  readonly label = input<string>();
  readonly tone = computed(() => TONES[this.status()] ?? '');
}

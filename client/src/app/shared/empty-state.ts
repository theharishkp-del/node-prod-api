/**
 * @file Empty-state placeholder component (icon, title, message, optional action).
 */
import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** Centered icon + title + text; projected content (e.g. a button) goes below. */
@Component({
  selector: 'app-empty-state',
  imports: [MatIconModule],
  template: `
    <div class="state">
      <div class="state-icon"><mat-icon>{{ icon() }}</mat-icon></div>
      <div class="state-title">{{ title() }}</div>
      @if (text()) {
        <div class="state-text">{{ text() }}</div>
      }
      <ng-content />
    </div>
  `,
})
export class EmptyState {
  readonly icon = input('inbox');
  readonly title = input.required<string>();
  readonly text = input<string>();
}

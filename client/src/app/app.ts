/**
 * @file Root component of the IQ Agent admin UI.
 */
import { Component, inject } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './core/theme.service';

/** Root component: router outlet only (the admin frame lives in layout/shell). */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  constructor() {
    // Self-hosted "Material Icons Outlined" font (material-icons package).
    inject(MatIconRegistry).setDefaultFontSetClass('material-icons-outlined');
    inject(ThemeService); // applies the stored light/dark mode
  }
}

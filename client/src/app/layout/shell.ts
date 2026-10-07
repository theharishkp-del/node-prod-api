/**
 * @file Application frame: responsive sidenav, top bar, theme toggle and account menu.
 */
import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, computed, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AdminKeyService } from '../core/admin-key.service';
import { ThemeService } from '../core/theme.service';
import { environment } from '../../environments/environment';

interface NavItem {
  label: string;
  icon: string;
  link: string;
}

/** App frame: top bar + responsive sidebar (side on desktop, overlay on mobile). */
@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatSidenavModule,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);
  protected readonly keys = inject(AdminKeyService);
  protected readonly appName = environment.appName;
  private readonly sidenav = viewChild.required(MatSidenav);

  protected readonly isMobile = toSignal(
    inject(BreakpointObserver)
      .observe('(max-width: 959.98px)')
      .pipe(map((r) => r.matches)),
    { initialValue: false },
  );
  protected readonly mode = computed(() => (this.isMobile() ? 'over' : 'side'));

  protected readonly nav: NavItem[] = [
    { label: 'Dashboard', icon: 'space_dashboard', link: '/dashboard' },
    { label: 'Organizations', icon: 'domain', link: '/organizations' },
    { label: 'Bots', icon: 'smart_toy', link: '/bots' },
  ];

  constructor() {
    // Close the overlay drawer after navigating on small screens.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      if (this.isMobile()) this.sidenav().close();
    });
  }

  protected signOut(): void {
    this.keys.clear();
    this.router.navigate(['/login']);
  }
}

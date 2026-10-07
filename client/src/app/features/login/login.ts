/**
 * @file Sign-in page for the admin API key.
 */
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router } from '@angular/router';
import { AdminKeyService } from '../../core/admin-key.service';
import { ThemeService } from '../../core/theme.service';

/**
 * Sign-in page: asks for the admin API key, verifies it against GET /auth/check and
 * stores it in localStorage. Skipped automatically when the server needs no key.
 */
@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login implements OnInit {
  private readonly keys = inject(AdminKeyService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly theme = inject(ThemeService);

  protected readonly key = new FormControl('', { nonNullable: true, validators: [Validators.required] });
  /** Wrapper group so (ngSubmit) is handled by FormGroupDirective (no native form post). */
  protected readonly form = new FormGroup({ key: this.key });
  protected readonly hide = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly expired = this.route.snapshot.queryParamMap.get('reason') === 'expired';

  ngOnInit(): void {
    // Open mode (no ADMIN_API_KEY on the server): go straight in.
    this.keys.verify(null).subscribe((ok) => {
      if (ok && !this.keys.authRequired()) {
        this.keys.verified.set(true);
        this.goBack();
      }
    });
  }

  protected submit(): void {
    if (this.key.invalid || this.busy()) return;
    const value = this.key.value.trim();
    this.busy.set(true);
    this.error.set(null);
    this.keys.verify(value).subscribe((ok) => {
      this.busy.set(false);
      if (!ok) {
        this.error.set('This key was not accepted by the server.');
        return;
      }
      this.keys.setKey(value);
      this.goBack();
    });
  }

  private goBack(): void {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    this.router.navigateByUrl(returnUrl && returnUrl.startsWith('/') && returnUrl !== '/login' ? returnUrl : '/dashboard');
  }
}

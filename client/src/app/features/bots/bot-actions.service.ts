/**
 * @file Shared bot actions with confirm dialogs and toasts (activate/deactivate, delete).
 */
import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, catchError, map, switchMap, tap } from 'rxjs';
import { AdminApi } from '../../core/admin-api.service';
import { Bot } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { ConfirmService } from '../../shared/confirm-dialog';

/** Confirm + call + toast for bot status changes and deletion. */
@Injectable({ providedIn: 'root' })
export class BotActions {
  private readonly api = inject(AdminApi);
  private readonly confirm = inject(ConfirmService);
  private readonly notify = inject(NotifyService);

  /** Deactivate an active bot or activate an inactive one. Emits the updated bot. */
  toggleStatus(bot: Bot): Observable<Bot> {
    const deactivate = bot.status === 'active';
    return this.confirm
      .confirm({
        title: deactivate ? `Deactivate ${bot.name}?` : `Activate ${bot.name}?`,
        message: deactivate
          ? `EO requests from bot ${bot.botUserId} will be answered with "bot inactive" until it is activated again.`
          : `Bot ${bot.botUserId} will start serving EO requests again.`,
        confirmText: deactivate ? 'Deactivate' : 'Activate',
        danger: deactivate,
        icon: deactivate ? 'pause_circle' : 'play_circle',
      })
      .pipe(
        switchMap((ok) => (ok ? this.api.setBotStatus(bot.botUserId, deactivate ? 'inactive' : 'active') : EMPTY)),
        tap((b) => this.notify.success(`${b.name} is now ${b.status}`)),
        catchError((err) => {
          this.notify.error(err, 'Could not change the status');
          return EMPTY;
        }),
      );
  }

  /** Delete a bot (its sessions stay in the tenant database). Emits once deleted. */
  delete(bot: Bot): Observable<void> {
    return this.confirm
      .confirm({
        title: `Delete ${bot.name}?`,
        message: `Bot ${bot.botUserId} is removed from the registry; its EO requests will be rejected. Past sessions stay in the tenant database.`,
        confirmText: 'Delete',
        danger: true,
        icon: 'delete_outline',
      })
      .pipe(
        switchMap((ok) => (ok ? this.api.deleteBot(bot.botUserId) : EMPTY)),
        tap(() => this.notify.success(`${bot.name} deleted`)),
        map(() => undefined),
        catchError((err) => {
          this.notify.error(err, 'Could not delete the bot');
          return EMPTY;
        }),
      );
  }
}

/**
 * @file Shared organization actions with confirm dialogs and toasts (suspend/activate, delete).
 */
import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, catchError, map, switchMap, tap } from 'rxjs';
import { AdminApi } from '../../core/admin-api.service';
import { Organization } from '../../core/models';
import { NotifyService } from '../../core/notify.service';
import { ConfirmService } from '../../shared/confirm-dialog';

/** Confirm + call + toast for organization status changes and deletion. */
@Injectable({ providedIn: 'root' })
export class OrganizationActions {
  private readonly api = inject(AdminApi);
  private readonly confirm = inject(ConfirmService);
  private readonly notify = inject(NotifyService);

  /** Suspend an active organization or re-activate a suspended one. Emits the updated org. */
  toggleStatus(org: Organization): Observable<Organization> {
    const suspend = org.status === 'active';
    return this.confirm
      .confirm({
        title: suspend ? `Suspend ${org.name}?` : `Activate ${org.name}?`,
        message: suspend
          ? 'All bots of this organization will answer EO requests with a "service suspended" message until it is activated again.'
          : 'Bots of this organization will start serving EO requests again.',
        confirmText: suspend ? 'Suspend' : 'Activate',
        danger: suspend,
        icon: suspend ? 'pause_circle' : 'play_circle',
      })
      .pipe(
        switchMap((ok) => (ok ? this.api.setOrganizationStatus(org.orgId, suspend ? 'suspended' : 'active') : EMPTY)),
        tap((o) => this.notify.success(`${o.name} is now ${o.status}`)),
        catchError((err) => {
          this.notify.error(err, 'Could not change the status');
          return EMPTY;
        }),
      );
  }

  /** Delete an organization (the API refuses while it still has bots). Emits once deleted. */
  delete(org: Organization): Observable<void> {
    return this.confirm
      .confirm({
        title: `Delete ${org.name}?`,
        message: `The organization record "${org.orgId}" is removed. Its tenant database (${org.dbName}) is kept. Organizations that still have bots cannot be deleted.`,
        confirmText: 'Delete',
        danger: true,
        icon: 'delete_outline',
      })
      .pipe(
        switchMap((ok) => (ok ? this.api.deleteOrganization(org.orgId) : EMPTY)),
        tap(() => this.notify.success(`${org.name} deleted`)),
        map(() => undefined),
        catchError((err) => {
          this.notify.error(err, 'Could not delete the organization');
          return EMPTY;
        }),
      );
  }
}

/**
 * @file Display pipes: relative time, EO sessionDate formatting and initials.
 */
import { Pipe, PipeTransform } from '@angular/core';
import { formatSessionDate, initials, timeAgo } from '../core/format';

/** {{ iso | timeAgo }} */
@Pipe({ name: 'timeAgo' })
export class TimeAgoPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return timeAgo(value);
  }
}

/** {{ '20261007062959549' | sessionDate }} -> 2026-10-07 06:29:59 */
@Pipe({ name: 'sessionDate' })
export class SessionDatePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return formatSessionDate(value);
  }
}

/** {{ name | initials }} */
@Pipe({ name: 'initials' })
export class InitialsPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return initials(value);
  }
}

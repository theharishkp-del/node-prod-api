/**
 * @file Pure formatting helpers (EO sessionDate, initials, relative time) used by the pipes.
 */
/** Small display helpers. */

/** '20261007062959549' -> '2026-10-07 06:29:59' (platform sessionDate, local platform time). */
export function formatSessionDate(value: string | null | undefined): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(value ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : value || '-';
}

/** Two-letter initials for avatars. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] ?? '')).toUpperCase();
}

/** '3 min ago', '2 h ago', '5 d ago' (falls back to a date). */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '-';
  const diff = Math.max(0, now - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

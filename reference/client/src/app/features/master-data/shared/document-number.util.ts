export function formatDateInputValue(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function extractNumberPrefix(value: string, fallbackPrefix: string): string {
  const trimmedValue = String(value || '').trim();

  if (!trimmedValue) {
    return fallbackPrefix;
  }

  const match = trimmedValue.match(/^([A-Za-z]+)[-_\/ ]?\d*$/);
  return match?.[1]?.toUpperCase() || fallbackPrefix;
}

export function buildNextDocumentNumber(existingNumbers: string[], prefix: string, fallbackSequence = 1): string {
  const normalizedPrefix = String(prefix || '').trim().toUpperCase() || 'DOC';
  const escapedPrefix = normalizedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`^${escapedPrefix}[-_/ ]?(\\d+)$`, 'i');

  let maxSequence = fallbackSequence - 1;

  for (const value of existingNumbers) {
    const match = String(value || '').trim().match(matcher);

    if (!match) {
      continue;
    }

    const parsedSequence = Number(match[1]);

    if (Number.isFinite(parsedSequence)) {
      maxSequence = Math.max(maxSequence, parsedSequence);
    }
  }

  const nextSequence = String(maxSequence + 1).padStart(4, '0');
  return `${normalizedPrefix}-${nextSequence}`;
}

import { MAX_ALL_DAY_SECONDS, parseDuration } from '@tokkl/common/duration';
import { snapDuration } from '@tokkl/common/snap';
import { t } from '../i18n/messages.ts';

/** Snapped as the server does. `seconds` is null when the text is unreadable. */
export function noTimeDuration(text: string, resolution: number): { seconds: number | null; error?: string } {
  const parsed = parseDuration(text);
  if (parsed === null) return { seconds: null, error: t('entries.durationUnreadable') };
  return noTimeSeconds(parsed, resolution);
}

export function noTimeSeconds(parsed: number, resolution: number): { seconds: number; error?: string } {
  const seconds = snapDuration(parsed, resolution);
  if (seconds <= 0) return { seconds, error: t('entries.durationRoundsToZero', { resolution }) };
  if (seconds > MAX_ALL_DAY_SECONDS) return { seconds, error: t('entries.durationTooLong') };
  return { seconds };
}

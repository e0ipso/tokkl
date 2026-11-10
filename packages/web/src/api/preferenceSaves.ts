import type { Preferences } from '@tokkl/types';

interface PendingSave {
  readonly changes: Partial<Preferences>;
}

/**
 * Saves run one at a time, so each reply holds every earlier save. The cache shows the latest reply plus
 * pending changes; a failed save drops only its own changes.
 */
export interface PreferenceSaves {
  /** `shown` is what the cache should show, if known. */
  begin(cached: Preferences | undefined, changes: Partial<Preferences>): { save: PendingSave; shown?: Preferences };
  succeeded(save: PendingSave, reply: Preferences): Preferences;
  /** Undefined when no server value is known yet. */
  failed(save: PendingSave): Preferences | undefined;
}

export function createPreferenceSaves(): PreferenceSaves {
  // The server's preferences as far as this tab knows: the latest reply, or the cache when the first save began.
  let confirmed: Preferences | undefined;
  let pending: PendingSave[] = [];

  const shown = (): Preferences | undefined =>
    confirmed && pending.reduce<Preferences>((view, save) => ({ ...view, ...save.changes }), confirmed);
  const settle = (save: PendingSave) => {
    pending = pending.filter(other => other !== save);
  };

  return {
    begin(cached, changes) {
      if (pending.length === 0) confirmed = cached;
      const save = { changes };
      pending = [...pending, save];
      return { save, shown: shown() };
    },
    succeeded(save, reply) {
      settle(save);
      confirmed = reply;
      return shown()!;
    },
    failed(save) {
      settle(save);
      return shown();
    },
  };
}

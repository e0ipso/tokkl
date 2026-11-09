import type { Preferences } from '@tokkl/types';

/** One preference save in progress: the fields it changes. */
interface PendingSave {
  readonly changes: Partial<Preferences>;
}

/**
 * What the preferences cache shows while saves overlap. Saves run one at a time, in the order they
 * were made (`scope` in `savePreferencesOptions`), so the server applies them in that order and
 * each reply already holds every earlier save. The cache always shows the server's latest reply
 * with the changes of the saves still waiting on top:
 * - a save that succeeds replaces the base with its reply;
 * - a save that fails drops its own changes and keeps the base, so it can neither undo a save that
 *   succeeded before it nor wipe a later change still on its way.
 */
export interface PreferenceSaves {
  /** Records a save as it is made. `cached` is what the cache holds now; `shown` is what it should show, if known. */
  begin(cached: Preferences | undefined, changes: Partial<Preferences>): { save: PendingSave; shown?: Preferences };
  /** What the cache shows after `save` succeeded with `reply`. */
  succeeded(save: PendingSave, reply: Preferences): Preferences;
  /** What the cache shows after `save` failed, or undefined when no server value is known yet. */
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

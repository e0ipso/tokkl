import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { savePreferencesOptions } from './account.ts';
import { keys } from './keys.ts';
import type { Preferences } from './types.ts';

const base = { theme: 'light', manualMode: false, timerView: 'list' } as unknown as Preferences;

/** A save the test answers by hand, as the server would. */
interface Sent {
  readonly changes: Partial<Preferences>;
  reply(preferences: Partial<Preferences>): void;
  fail(): void;
}

/**
 * A client with `base` cached and a stand-in for the server. `save` starts a save the way
 * `useSavePreferences().mutate` does, and `sent` lists the requests that went out, in order.
 */
function setup(cached: Preferences | null = base) {
  const qc = new QueryClient();
  if (cached) qc.setQueryData(keys.preferences, cached);
  const sent: Sent[] = [];
  const options = savePreferencesOptions(qc, changes => {
    return new Promise<Preferences>((resolve, reject) => {
      sent.push({
        changes,
        reply: preferences => resolve({ ...base, ...preferences }),
        fail: () => reject(new Error('Preferences not saved')),
      });
    });
  });
  const save = (changes: Partial<Preferences>) =>
    qc
      .getMutationCache()
      .build(qc, options)
      .execute(changes)
      .catch(() => undefined);
  const shown = () => qc.getQueryData<Preferences>(keys.preferences);
  const settled = () => new Promise(resolve => setTimeout(resolve, 0));
  const nth = (index: number): Sent => {
    const request = sent[index];
    if (!request) throw new Error(`Request ${index} was not sent`);
    return request;
  };
  return { save, sent, nth, shown, settled };
}

test('both changes show at once, and the second save goes out only after the first has its reply', async () => {
  const { save, sent, nth, shown, settled } = setup();
  const first = save({ theme: 'dark' } as Partial<Preferences>);
  const second = save({ manualMode: true });
  await settled();
  assert.equal(shown()?.theme, 'dark');
  assert.equal(shown()?.manualMode, true);
  assert.equal(sent.length, 1, 'the second save waits');

  nth(0).reply({ theme: 'dark' } as Partial<Preferences>);
  await first;
  await settled();
  assert.equal(sent.length, 2);
  // The first reply does not know the second change yet, which stays on screen.
  assert.equal(shown()?.manualMode, true);
  nth(1).reply({ theme: 'dark', manualMode: true } as Partial<Preferences>);
  await second;
  assert.deepEqual(shown(), { ...base, theme: 'dark', manualMode: true });
});

test('an earlier save that fails drops only its own change, never a later one', async () => {
  const { save, nth, shown, settled } = setup();
  const first = save({ theme: 'dark' } as Partial<Preferences>);
  const second = save({ manualMode: true });
  await settled();
  nth(0).fail();
  await first;
  assert.equal(shown()?.theme, 'light', 'the failed change is undone');
  assert.equal(shown()?.manualMode, true, 'the later change still shows');
  await settled();
  nth(1).reply({ manualMode: true });
  await second;
  assert.deepEqual(shown(), { ...base, manualMode: true });
});

test('a later save that fails falls back to the earlier save the server confirmed', async () => {
  const { save, nth, shown, settled } = setup();
  const first = save({ theme: 'dark' } as Partial<Preferences>);
  const second = save({ theme: 'system' } as Partial<Preferences>);
  await settled();
  assert.equal(shown()?.theme, 'system');
  nth(0).reply({ theme: 'dark' } as Partial<Preferences>);
  await first;
  await settled();
  assert.equal(shown()?.theme, 'system', "the first reply does not replace the second save's value");
  nth(1).fail();
  await second;
  assert.equal(shown()?.theme, 'dark');
});

test('a save made after the earlier ones settled starts from the cache as it is then', async () => {
  const { save, nth, shown, settled } = setup();
  const first = save({ timerView: 'calendar' } as Partial<Preferences>);
  await settled();
  nth(0).reply({ timerView: 'calendar' } as Partial<Preferences>);
  await first;
  const second = save({ manualMode: true });
  await settled();
  nth(1).fail();
  await second;
  assert.deepEqual(shown(), { ...base, timerView: 'calendar' });
});

test('with no preferences loaded, a failed save leaves the cache empty', async () => {
  const { save, nth, shown, settled } = setup(null);
  const first = save({ manualMode: true });
  await settled();
  assert.equal(shown(), undefined);
  nth(0).fail();
  await first;
  assert.equal(shown(), undefined);
});

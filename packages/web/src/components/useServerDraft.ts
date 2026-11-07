import { useState } from 'react';
import { hasEdits, mergedDraft, unstoredEdits, withEdit } from './serverDraft.ts';

/**
 * A form over values the server holds, which keeps only what the user changed. Every other field
 * shows the server's value, so a background refetch (after a change on another device, say)
 * updates the untouched fields and leaves the edits and focus alone.
 *
 * A field changed back to the server's value is no longer an edit, except while `saving`: the
 * server's value may be about to change, so everything typed then stays an edit until the caller
 * calls `dropEditsMatching` once the save settles. That drops the edits equal to what the server
 * now holds and keeps anything else typed while the request ran, even a value equal to what the
 * server had before the save. The rules live in serverDraft.ts.
 *
 * `server` is the server's values in the form's own shape, such as numbers as the text in their
 * inputs, and is compared with `Object.is`.
 */
export function useServerDraft<D extends object>(server: D, saving: boolean) {
  const [edits, setEdits] = useState<Partial<D>>({});

  const set = <K extends keyof D>(key: K, value: D[K]) =>
    setEdits(current => withEdit(current, server, saving, key, value));

  /** Drops the edits for which `isStored` says the server now holds that value. */
  const dropEditsMatching = (isStored: <K extends keyof D>(key: K, value: D[K]) => boolean) =>
    setEdits(current => unstoredEdits(current, isStored));

  return { draft: mergedDraft(server, edits), edits, set, dropEditsMatching, hasEdits: hasEdits(edits) };
}

import { useState } from 'react';

/**
 * Keeps only the user's edits; untouched fields follow the server. While `saving`, a value equal to the server's
 * stays an edit until `dropEditsMatching`. Values compare with `Object.is`.
 */
export function useServerDraft<D extends object>(server: D, saving: boolean) {
  const [edits, setEdits] = useState<Partial<D>>({});

  const set = <K extends keyof D>(key: K, value: D[K]) =>
    setEdits(current => withEdit(current, server, saving, key, value));

  /** For which `isStored` says the server now holds that value. */
  const dropEditsMatching = (isStored: <K extends keyof D>(key: K, value: D[K]) => boolean) =>
    setEdits(current => unstoredEdits(current, isStored));

  return { draft: { ...server, ...edits }, edits, set, dropEditsMatching, hasEdits: Object.keys(edits).length > 0 };
}

/** A value equal to the server's is no longer an edit, except while `saving`. */
export function withEdit<D extends object, K extends keyof D>(
  edits: Partial<D>,
  server: D,
  saving: boolean,
  key: K,
  value: D[K],
): Partial<D> {
  const next = { ...edits };
  if (!saving && Object.is(value, server[key])) delete next[key];
  else next[key] = value;
  return next;
}

export function unstoredEdits<D extends object>(
  edits: Partial<D>,
  isStored: <K extends keyof D>(key: K, value: D[K]) => boolean,
): Partial<D> {
  const next: Partial<D> = {};
  // Only `withEdit` adds to `edits`, and only keys of D.
  for (const key of Object.keys(edits) as Array<keyof D>) {
    const value = edits[key];
    if (value !== undefined && !isStored(key, value)) next[key] = value;
  }
  return next;
}

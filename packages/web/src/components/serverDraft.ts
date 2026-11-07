/**
 * The rules behind `useServerDraft`: a form over server values keeps only what the user changed.
 * The hook holds `edits` in state; these functions decide what goes in it.
 */

/** What the form shows: the server's values with the user's edits on top. */
export function mergedDraft<D extends object>(server: D, edits: Partial<D>): D {
  return { ...server, ...edits };
}

/**
 * The edits after the user sets `key` to `value`. A value equal to the server's (by `Object.is`)
 * is no longer an edit, except while `saving`: the server's value may be about to change, so
 * everything typed then stays an edit.
 */
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

/** The edits for which `isStored` says the server does not hold that value yet. */
export function unstoredEdits<D extends object>(
  edits: Partial<D>,
  isStored: <K extends keyof D>(key: K, value: D[K]) => boolean,
): Partial<D> {
  const next: Partial<D> = {};
  for (const key of editedKeys(edits)) {
    const value = edits[key];
    if (value !== undefined && !isStored(key, value)) next[key] = value;
  }
  return next;
}

export function hasEdits<D extends object>(edits: Partial<D>): boolean {
  return editedKeys(edits).length > 0;
}

/** The keys of `edits`. Only `withEdit` adds to it, and only keys of D. */
function editedKeys<D extends object>(edits: Partial<D>): Array<keyof D> {
  return Object.keys(edits) as Array<keyof D>;
}

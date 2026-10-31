export type StorageConflictKind = 'unique' | 'foreign-key' | 'serialization' | 'deadlock' | 'busy';
/** Safe to expose to domain error mapping. No SQL, constraint names or driver cause. */
export class StorageConflict extends Error {
  readonly kind: StorageConflictKind;
  constructor(kind: StorageConflictKind) { super(`Storage conflict (${kind})`); this.name = 'StorageConflict'; this.kind = kind; }
}
export class StorageTransactionError extends Error {
  readonly outcome: 'rolled-back' | 'unknown';
  constructor(outcome: 'rolled-back' | 'unknown') { super(`Storage transaction failed (${outcome})`); this.name = 'StorageTransactionError'; this.outcome = outcome; }
}
export function classifyConflict(error: unknown): StorageConflict | undefined {
  if (error instanceof StorageConflict) return error;
  if (!error || typeof error !== 'object') return;
  const { code, errno, errcode } = error as { code?: string; errno?: number; errcode?: number };
  if (code === '23505' || errno === 1062 || errcode === 2067 || errcode === 1555) return new StorageConflict('unique');
  if (code === '23503' || errno === 1451 || errno === 1452 || errcode === 787) return new StorageConflict('foreign-key');
  if (code === '40001') return new StorageConflict('serialization');
  if (code === '40P01' || errno === 1213) return new StorageConflict('deadlock');
  if (errno === 1205 || (errcode !== undefined && [5, 6].includes(errcode % 256))) return new StorageConflict('busy');
}

/** A map that holds at most `capacity` entries and forgets the least recently used one first. */
export class BoundedCache<K, V> {
  readonly #entries = new Map<K, V>();
  readonly #capacity: number;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Invalid cache capacity');
    this.#capacity = capacity;
  }

  get size(): number {
    return this.#entries.size;
  }

  has(key: K): boolean {
    return this.#entries.has(key);
  }

  get(key: K): V | undefined {
    if (!this.#entries.has(key)) return undefined;
    const value = this.#entries.get(key) as V;
    // Re-inserting moves the key to the end, which is what eviction treats as most recent.
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  /** Stores `value` and returns it, evicting the least recently used entry when a new key would overflow. */
  set(key: K, value: V): V {
    if (!this.#entries.has(key) && this.#entries.size >= this.#capacity)
      this.#entries.delete(this.#entries.keys().next().value as K);
    this.#entries.set(key, value);
    return value;
  }

  clear(): void {
    this.#entries.clear();
  }
}

/**
 * Wraps an async lookup so equal arguments, compared as JSON, reuse the first answer. `clear` drops
 * every answer, for when a rollback may have made them stale.
 */
export function memoizeAsync<A extends unknown[], V>(
  read: (...args: A) => Promise<V>,
  capacity: number,
): ((...args: A) => Promise<V>) & { clear(): void } {
  const cache = new BoundedCache<string, V>(capacity);
  return Object.assign(
    async (...args: A) => {
      const key = JSON.stringify(args);
      if (cache.has(key)) return cache.get(key) as V;
      return cache.set(key, await read(...args));
    },
    { clear: () => cache.clear() },
  );
}

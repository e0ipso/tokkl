import type { TimerState } from '@tokkl/types';
export class TimerHub {
  readonly #users = new Map<number, Set<(state: TimerState) => void | Promise<void>>>();
  subscribe(id: number, listener: (state: TimerState) => void | Promise<void>): () => void {
    const listeners = this.#users.get(id) ?? new Set();
    this.#users.set(id, listeners);
    listeners.add(listener);
    return () => { listeners.delete(listener); if (!listeners.size && this.#users.get(id) === listeners)
      this.#users.delete(id); };
  }
  forgetUser(id: number): void { this.#users.delete(id); }
  async publish(id: number, state: TimerState): Promise<void> {
    const results = await Promise.allSettled([...this.#users.get(id) ?? []].map(async (listener) => listener(structuredClone(state))));
    for (const result of results)
      if (result.status === 'rejected')
        console.error('Timer subscriber failed');
  }
  close(): void { this.#users.clear(); }
}

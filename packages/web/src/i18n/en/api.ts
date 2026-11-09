import type { MessageGroup } from '../catalog.ts';

/** Request failures the app words itself, when the server sent no message or an unusable reply. */
export const api = {
  requestFailed: 'Request failed ({status})',
  /** A request that got no whole reply within its deadline (`DEADLINE_MS` in api/client.ts). */
  timedOut: 'The server took too long to answer. Try again.',
  /** A reply of the wrong kind, such as a list where an object belongs. */
  unreadableReply: 'The server sent an unreadable reply.',
} as const satisfies MessageGroup;

import type { MessageGroup } from '../catalog.ts';

export const api = {
  requestFailed: 'Request failed ({status})',
  /** `DEADLINE_MS` in api/client.ts. */
  timedOut: 'The server took too long to answer. Try again.',
  unreadableReply: 'The server sent an unreadable reply.',
} as const satisfies MessageGroup;

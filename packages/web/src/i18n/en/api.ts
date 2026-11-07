import type { MessageGroup } from '../catalog.ts';

/** Request failures the app words itself, when the server sent no message or an unusable reply. */
export const api = {
  requestFailed: 'Request failed ({status})',
  /** A reply field of the wrong kind, such as "reply[3].tags is not a list". */
  unreadableReply: 'The server sent an unreadable reply: {at} is not {expected}.',
  expectText: 'text',
  expectNumber: 'a number',
  expectBoolean: 'true or false',
  expectOneOf: 'one of {values}',
  expectList: 'a list',
  expectObject: 'an object',
} as const satisfies MessageGroup;

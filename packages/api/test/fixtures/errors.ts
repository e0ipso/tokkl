import assert from 'node:assert/strict';
import { ApplicationError } from '../../src/lib/errors.ts';
import { errorReply } from '../../src/http/errors.ts';

/**
 * An `assert.rejects` check: the operation failed with an application error that the API answers
 * with `status`, and with `message` when one is given.
 */
export function failsWith(status: number, message?: string): (error: unknown) => true {
  return error => {
    assert.ok(error instanceof ApplicationError, `expected an application error, got ${String(error)}`);
    assert.equal(errorReply(error).status, status);
    if (message !== undefined) assert.equal(error.message, message);
    return true;
  };
}

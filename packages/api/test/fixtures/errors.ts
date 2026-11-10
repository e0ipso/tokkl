import assert from 'node:assert/strict';
import { ApplicationError } from '../../src/lib/errors.ts';
import { errorReply } from '../../src/http/errors.ts';

/** For `assert.rejects`: an application error the API answers with `status`, and `message` when given. */
export function failsWith(status: number, message?: string): (error: unknown) => true {
  return error => {
    assert.ok(error instanceof ApplicationError, `expected an application error, got ${String(error)}`);
    assert.equal(errorReply(error).status, status);
    if (message !== undefined) assert.equal(error.message, message);
    return true;
  };
}

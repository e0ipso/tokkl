import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../../../api/client.ts';
import { emailChanged, refusedProfileField } from './profileForm.ts';

test('only a real email change asks for the current password', () => {
  assert.equal(emailChanged('ana@example.com', 'ana@example.com'), false);
  assert.equal(emailChanged('ana@example.com', 'Ana@Example.COM'), false, 'ASCII recasing is no change');
  assert.equal(emailChanged('ana@example.com', '  ana@example.com \t'), false, 'surrounding whitespace is no change');
  assert.equal(emailChanged('ärger@example.com', 'Ärger@example.com'), true, 'the server keeps non-ASCII case');
  assert.equal(emailChanged('ana@example.com', 'bea@example.com'), true);
});

test('server refusals go to the field that caused them', () => {
  const refusal = (status: number, message: string) => new ApiError(status, message);
  assert.equal(refusedProfileField(refusal(400, 'Current password is required')), 'currentPassword');
  assert.equal(refusedProfileField(refusal(400, 'Current password is not valid')), 'currentPassword');
  assert.equal(refusedProfileField(refusal(400, 'Email already in use')), 'email');
  assert.equal(refusedProfileField(refusal(429, 'Too many failed attempts, try again later')), undefined);
  assert.equal(refusedProfileField(refusal(429, 'Current password is not valid')), undefined, 'a 429 is a toast');
  assert.equal(refusedProfileField(refusal(400, 'Invalid timezone')), undefined);
  assert.equal(refusedProfileField(new Error('Failed to fetch')), undefined);
});

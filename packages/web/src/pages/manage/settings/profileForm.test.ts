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
  const shown = (error: Error) => refusedProfileField(error, true);
  assert.equal(shown(refusal(400, 'Current password is required')), 'currentPassword');
  assert.equal(shown(refusal(400, 'Current password is not valid')), 'currentPassword');
  assert.equal(shown(refusal(400, 'Email already in use')), 'email');
  assert.equal(shown(refusal(429, 'Too many failed attempts, try again later')), undefined);
  assert.equal(shown(refusal(429, 'Current password is not valid')), undefined, 'a 429 is a toast');
  assert.equal(shown(refusal(400, 'Invalid timezone')), undefined);
  assert.equal(shown(new Error('Failed to fetch')), undefined);
});

test('a password refusal without the password field is a toast, not an error on a hidden field', () => {
  // Another session changed the email, so this form still sends the old one and the server sees a change.
  const required = new ApiError(400, 'Current password is required');
  assert.equal(refusedProfileField(required, false), undefined);
  assert.equal(refusedProfileField(new ApiError(400, 'Email already in use'), false), 'email');
});

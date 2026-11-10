import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TypedSecret, connectionIdentity } from '../typedsecret.js';

const url = 'https://tokkl.example.com';
const typedFor = (secret, ...connection) => {
    const typed = new TypedSecret();
    typed.edited(secret, connectionIdentity(...connection));
    return typed;
};

test('the secret stays while the connection it was typed for is the same', () => {
    const typed = typedFor('hunter2', url, 'password', 'me@example.com');
    assert.equal(typed.staleFor('hunter2', connectionIdentity(url, 'password', 'me@example.com')), false);
    assert.equal(typed.staleFor('hunter2', connectionIdentity(` ${url} `, 'password', ' me@example.com')), false);
});

test('another instance URL, sign-in method or email drops the secret', () => {
    const typed = typedFor('hunter2', url, 'password', 'me@example.com');
    assert.equal(
        typed.staleFor('hunter2', connectionIdentity('https://other.example.com', 'password', 'me@example.com')),
        true,
    );
    assert.equal(typed.staleFor('hunter2', connectionIdentity(url, 'token', 'me@example.com')), true);
    assert.equal(typed.staleFor('hunter2', connectionIdentity(url, 'password', 'you@example.com')), true);
});

test('the email is no part of a token sign-in', () => {
    const typed = typedFor('tok', url, 'token', 'me@example.com');
    assert.equal(typed.staleFor('tok', connectionIdentity(url, 'token', '')), false);
    assert.equal(typed.staleFor('tok', connectionIdentity(url, 'password', 'me@example.com')), true);
});

test('a secret typed again after the change belongs to the new connection', () => {
    const typed = typedFor('old', url, 'token', '');
    const other = connectionIdentity('https://other.example.com', 'token', '');
    assert.equal(typed.staleFor('old', other), true);
    typed.edited('', other);
    typed.edited('new', other);
    assert.equal(typed.staleFor('new', other), false);
    assert.equal(typed.staleFor('new', connectionIdentity(url, 'token', '')), true);
});

test('an empty secret is never stale', () => {
    const typed = new TypedSecret();
    assert.equal(typed.staleFor('', connectionIdentity(url, 'token', '')), false);
    const emptied = typedFor('', url, 'token', '');
    assert.equal(emptied.staleFor('', connectionIdentity('https://other.example.com', 'token', '')), false);
});

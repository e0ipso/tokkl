// The cases are shared with the core's ConnectionSetup test.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { isInsecureUrl } from '../instanceurl.js';

const { cases } = JSON.parse(
    readFileSync(new URL('../../../core/autotests/insecureurls.json', import.meta.url), 'utf8'),
);

test('a plain-http address is flagged as the KDE and macOS settings flag it', () => {
    assert.ok(cases.length > 10);
    for (const { url, insecure } of cases) assert.equal(isInsecureUrl(url), insecure, JSON.stringify(url));
});

test('a port out of range or an address that is not IPv6 makes the address unusable', () => {
    assert.equal(isInsecureUrl('http://tokkl.example.test:70000'), false);
    assert.equal(isInsecureUrl('http://[::1::2]'), false);
    assert.equal(isInsecureUrl('http://[0:0:0:0:0:0:0:1]'), false);
    assert.equal(isInsecureUrl('http://[::2]'), true);
});

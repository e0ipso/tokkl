// Tests for timerrequests.js, Start, Stop, Pause and Resume as requests
// with a fallback for a tokkl-timerd without them:
//   node --test 'desktop/gnome/extension/**/*.test.js'

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TimerRequests } from '../timerrequests.js';

const unknownMethod = { name: 'org.freedesktop.DBus.Error.UnknownMethod' };
const isUnknownMethod = error => error === unknownMethod;

// A service that answers each call from answers, by method name, and
// records the calls.
function service(answers) {
    const calls = [];
    const call = (method, done) => {
        calls.push(method);
        const [reply, error] = answers[method] ?? [null, unknownMethod];
        done(reply, error);
    };
    return { calls, requests: new TimerRequests(call, isUnknownMethod) };
}

test('a request reports its own end, and no other', () => {
    const { calls, requests } = service({ RequestStart: [[7], null], RequestStop: [[8], null] });
    const ends = [];
    const sent = [];
    requests.send('Start', {
        sent: value => sent.push(value),
        finished: (ok, error) => ends.push(['start', ok, error]),
    });
    requests.send('Stop', { finished: (ok, error) => ends.push(['stop', ok, error]) });
    assert.deepEqual(calls, ['RequestStart', 'RequestStop']);
    assert.deepEqual(sent, [true]);

    requests.finished(99, false, 'not ours');
    requests.finished(8, true, '');
    requests.finished(7n, false, 'This project is archived.');
    // Each id ends once.
    requests.finished(7, true, '');
    assert.deepEqual(ends, [
        ['stop', true, ''],
        ['start', false, 'This project is archived.'],
    ]);
});

test('a request the service did not send never ends', () => {
    const { requests } = service({ RequestPause: [[0], null] });
    const ends = [];
    const sent = [];
    requests.send('Pause', { sent: value => sent.push(value), finished: ok => ends.push(ok) });
    requests.finished(0, false, '');
    assert.deepEqual(sent, [false]);
    assert.deepEqual(ends, []);
});

test('an older service gets the plain method, and keeps getting it until reset', () => {
    const { calls, requests } = service({ Start: [[true], null], Stop: [[false], null], RequestStop: [[3], null] });
    const sent = [];
    const ends = [];
    requests.send('Start', { sent: value => sent.push(value), finished: ok => ends.push(ok) });
    requests.send('Stop', { sent: value => sent.push(value) });
    assert.deepEqual(calls, ['RequestStart', 'Start', 'Stop']);
    assert.deepEqual(sent, [true, false]);
    assert.deepEqual(ends, []);

    // Another service owns the name: it is asked again.
    requests.reset();
    requests.send('Stop', { sent: value => sent.push(value) });
    assert.deepEqual(calls.slice(3), ['RequestStop']);
    assert.deepEqual(sent, [true, false, true]);
});

test('a call that fails otherwise reports the error and falls back to nothing', () => {
    const broken = { name: 'org.freedesktop.DBus.Error.NoReply' };
    const { calls, requests } = service({ RequestResume: [null, broken] });
    const sent = [];
    requests.send('Resume', { sent: (value, error) => sent.push([value, error]) });
    assert.deepEqual(calls, ['RequestResume']);
    assert.deepEqual(sent, [[null, broken]]);
});

test('reset forgets the requests on their way', () => {
    const { requests } = service({ RequestStart: [[4], null] });
    const ends = [];
    requests.send('Start', { finished: ok => ends.push(ok) });
    requests.reset();
    requests.finished(4, true, '');
    assert.deepEqual(ends, []);
});

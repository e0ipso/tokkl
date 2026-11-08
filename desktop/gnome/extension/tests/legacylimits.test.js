// Tests for legacylimits.js, the Pomodoro length limits for a tokkl-timerd
// without the PomodoroLengthLimits property:
//   node --test 'desktop/gnome/extension/**/*.test.js'

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LEGACY_LENGTH_LIMITS, lengthLimits } from '../legacylimits.js';

test('a service without the property gets the limits the preferences had built in', () => {
    assert.deepEqual(lengthLimits(null), {
        work: { min: 1, max: 180, default: 25 },
        shortRest: { min: 1, max: 60, default: 5 },
        longRest: { min: 1, max: 60, default: 15 },
        longRestEvery: { min: 1, max: 12, default: 4 },
    });
    assert.equal(lengthLimits(undefined), LEGACY_LENGTH_LIMITS);
});

test('the published limits win', () => {
    const published = {
        work: { min: 5, max: 90, default: 30 },
        shortRest: { min: 1, max: 30, default: 5 },
        longRest: { min: 2, max: 45, default: 20 },
        longRestEvery: { min: 2, max: 8, default: 4 },
    };
    assert.deepEqual(lengthLimits(published), published);
});

test('a length the property leaves out or gives no usable range keeps its built-in limit', () => {
    const limits = lengthLimits({
        work: { min: 1, max: 120, default: 25, extra: true },
        shortRest: { min: 10, max: 5, default: 7 },
        longRest: { min: 1, max: 60 },
    });
    assert.deepEqual(limits.work, { min: 1, max: 120, default: 25 });
    assert.deepEqual(limits.shortRest, LEGACY_LENGTH_LIMITS.shortRest);
    assert.deepEqual(limits.longRest, LEGACY_LENGTH_LIMITS.longRest);
    assert.deepEqual(limits.longRestEvery, LEGACY_LENGTH_LIMITS.longRestEvery);
});

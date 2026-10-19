import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  breakPhase,
  DEFAULT_POMODORO_SETTINGS,
  nextBreak,
  nextCompletedCount,
  nextWorkPhase,
  workPhase,
  type BreakKind,
  type CycleEvent,
  type PomodoroSettings,
} from './pomodoro.ts';
import pomodoroFixture from './fixtures/pomodoro.json' with { type: 'json' };

type Input =
  | { function: 'workPhase'; workSeconds: number; running: boolean; now: string }
  | { function: 'nextBreak'; completed: number }
  | { function: 'breakPhase'; kind: BreakKind; startedAt: string; now: string }
  | { function: 'nextWorkPhase'; kind: BreakKind; startedAt: string; running: boolean; now: string }
  | { function: 'nextCompletedCount'; completed: number; event: FixtureEvent };

type FixtureEvent =
  | Exclude<CycleEvent, { type: 'idle' }>
  | { type: 'idle'; lastActiveAt: string; now: string };

interface PomodoroCase {
  name: string;
  input: Input;
  options?: Partial<PomodoroSettings>;
  expected: unknown;
}

// The fixture holds one shape per function, keyed by `input.function`, and the break kinds are
// plain strings in JSON, so TypeScript cannot narrow the imported array to these cases itself.
const pomodoroCases = pomodoroFixture as unknown as PomodoroCase[];
const errors: Record<string, ErrorConstructor> = { RangeError };

/** Calls the function a case names and turns every Date in the result into an ISO string. */
function run(input: Input, settings: PomodoroSettings): unknown {
  switch (input.function) {
    case 'workPhase': {
      const phase = workPhase(input.workSeconds, input.running, new Date(input.now), settings);
      return { ...phase, endsAt: phase.endsAt?.toISOString() ?? null };
    }
    case 'nextBreak':
      return nextBreak(input.completed, settings);
    case 'breakPhase': {
      const phase = breakPhase(input.kind, new Date(input.startedAt), new Date(input.now), settings);
      return { ...phase, endsAt: phase.endsAt.toISOString() };
    }
    case 'nextWorkPhase': {
      const next = nextWorkPhase(input.kind, new Date(input.startedAt), input.running, new Date(input.now), settings);
      return next && { ...next, start: next.start.toISOString() };
    }
    case 'nextCompletedCount':
      return nextCompletedCount(input.completed, cycleEvent(input.event), settings);
    default:
      throw new Error(`unknown function ${(input as { function: unknown }).function}`);
  }
}

function cycleEvent(event: FixtureEvent): CycleEvent {
  if (event.type !== 'idle') return event;
  return { type: 'idle', lastActiveAt: new Date(event.lastActiveAt), now: new Date(event.now) };
}

for (const { name, input, options, expected } of pomodoroCases) {
  test(`${input.function}: ${name}`, () => {
    const settings = { ...DEFAULT_POMODORO_SETTINGS, ...options };
    if (expected !== null && typeof expected === 'object' && 'throws' in expected) {
      const error = errors[String(expected.throws)];
      assert.ok(error, `unknown error type ${String(expected.throws)}`);
      assert.throws(() => run(input, settings), error);
      return;
    }
    assert.deepEqual(run(input, settings), expected);
  });
}

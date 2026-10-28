import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POMODORO_SESSION_CONFIG,
  nextPhase,
  plannedEnd,
  startSession,
  transitionKind,
  type PomodoroSessionConfig,
  type SessionPhase,
  type SessionPhaseKind,
} from './pomodoroSession.ts';
import sessionFixture from './fixtures/pomodoroSession.json' with { type: 'json' };

interface FixturePhase {
  kind: SessionPhaseKind;
  startedAt: string;
  completed: number;
}

type Input =
  | { function: 'startSession'; at: string }
  | { function: 'plannedEnd'; phase: FixturePhase }
  | { function: 'transitionKind'; phase: FixturePhase }
  | { function: 'nextPhase'; phase: FixturePhase; at: string };

interface SessionCase {
  name: string;
  input: Input;
  options?: Partial<PomodoroSessionConfig>;
  expected: unknown;
}

// The fixture holds one shape per function, keyed by `input.function`, and the phase kinds are
// plain strings in JSON, so TypeScript cannot narrow the imported array to these cases itself.
const sessionCases = sessionFixture as unknown as SessionCase[];
const errors: Record<string, ErrorConstructor> = { RangeError };

function toPhase(phase: FixturePhase): SessionPhase {
  return { ...phase, startedAt: new Date(phase.startedAt) };
}

function fromPhase(phase: SessionPhase): unknown {
  return { ...phase, startedAt: phase.startedAt.toISOString() };
}

/** Calls the function a case names and turns every Date in the result into an ISO string. */
function run(input: Input, config: PomodoroSessionConfig): unknown {
  switch (input.function) {
    case 'startSession':
      return fromPhase(startSession(new Date(input.at)));
    case 'plannedEnd':
      return plannedEnd(toPhase(input.phase), config).toISOString();
    case 'transitionKind':
      return transitionKind(toPhase(input.phase), config);
    case 'nextPhase': {
      const change = nextPhase(toPhase(input.phase), new Date(input.at), config);
      return { ...change, next: fromPhase(change.next) };
    }
    default:
      throw new Error(`unknown function ${(input as { function: unknown }).function}`);
  }
}

for (const { name, input, options, expected } of sessionCases) {
  test(`${input.function}: ${name}`, () => {
    const config = { ...DEFAULT_POMODORO_SESSION_CONFIG, ...options };
    if (expected !== null && typeof expected === 'object' && 'throws' in expected) {
      const error = errors[String(expected.throws)];
      assert.ok(error, `unknown error type ${String(expected.throws)}`);
      assert.throws(() => run(input, config), error);
      return;
    }
    assert.deepEqual(run(input, config), expected);
  });
}

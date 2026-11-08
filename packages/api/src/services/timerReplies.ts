import type { TimerState } from '@tokkl/types';
import { TimerRefusal, type TimerOperations } from '../domain/timers.ts';
import type { TimerView } from '../domain/timerView.ts';
import type { Id } from '../domain/model.ts';
import { StateConflict } from '../lib/errors.ts';
import { presentTimerState } from '../presenters/timer.ts';

/** The timer operations as clients see them: each answer and each refusal carries a `TimerState`. */
export type PresentedTimerOperations = {
  [Name in keyof TimerOperations]: (...args: Parameters<TimerOperations[Name]>) => Promise<TimerState>;
};

/** Presents a committed view, or a refusal's view, after the operation's transaction ended. */
async function presented(work: Promise<TimerView>): Promise<TimerState> {
  try {
    return presentTimerState(await work);
  } catch (error) {
    if (error instanceof TimerRefusal) throw new StateConflict(error.message, presentTimerState(error.state));
    throw error;
  }
}

/** An operation that takes the user first, without that argument. */
type ForUser<Operation> = Operation extends (userId: Id, ...rest: infer Rest) => infer Result
  ? (...rest: Rest) => Result
  : never;

/** The presented timer operations of one user, bound the way `entriesFor` and `catalogsFor` bind theirs. */
export type SignedInTimerOperations = {
  [Name in keyof PresentedTimerOperations]: ForUser<PresentedTimerOperations[Name]>;
};

export function bindTimerUser(operations: PresentedTimerOperations, userId: Id): SignedInTimerOperations {
  return {
    getTimerState: (...args) => operations.getTimerState(userId, ...args),
    startTimer: (...args) => operations.startTimer(userId, ...args),
    stopTimer: (...args) => operations.stopTimer(userId, ...args),
    editTimer: (...args) => operations.editTimer(userId, ...args),
    startPomodoro: (...args) => operations.startPomodoro(userId, ...args),
    nextPomodoroPhase: (...args) => operations.nextPomodoroPhase(userId, ...args),
    endPomodoro: (...args) => operations.endPomodoro(userId, ...args),
    pauseTimer: (...args) => operations.pauseTimer(userId, ...args),
    resumeTimer: (...args) => operations.resumeTimer(userId, ...args),
    discardPause: (...args) => operations.discardPause(userId, ...args),
  };
}

export function presentTimerOperations(operations: TimerOperations): PresentedTimerOperations {
  return {
    getTimerState: (...args) => presented(operations.getTimerState(...args)),
    startTimer: (...args) => presented(operations.startTimer(...args)),
    stopTimer: (...args) => presented(operations.stopTimer(...args)),
    editTimer: (...args) => presented(operations.editTimer(...args)),
    startPomodoro: (...args) => presented(operations.startPomodoro(...args)),
    nextPomodoroPhase: (...args) => presented(operations.nextPomodoroPhase(...args)),
    endPomodoro: (...args) => presented(operations.endPomodoro(...args)),
    pauseTimer: (...args) => presented(operations.pauseTimer(...args)),
    resumeTimer: (...args) => presented(operations.resumeTimer(...args)),
    discardPause: (...args) => presented(operations.discardPause(...args)),
  };
}

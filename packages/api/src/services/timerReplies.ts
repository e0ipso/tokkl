import type { TimerState } from '@tokkl/types';
import { TimerRefusal, type TimerOperations } from '../domain/timers.ts';
import type { TimerView } from '../domain/timerView.ts';
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

export function presentTimerOperations(operations: TimerOperations): PresentedTimerOperations {
  return {
    getTimerState: (...args) => presented(operations.getTimerState(...args)),
    startPomodoro: (...args) => presented(operations.startPomodoro(...args)),
    nextPomodoroPhase: (...args) => presented(operations.nextPomodoroPhase(...args)),
    endPomodoro: (...args) => presented(operations.endPomodoro(...args)),
    pauseTimer: (...args) => presented(operations.pauseTimer(...args)),
    resumeTimer: (...args) => presented(operations.resumeTimer(...args)),
    discardPause: (...args) => presented(operations.discardPause(...args)),
  };
}

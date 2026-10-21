import { plannedEnd, type SessionPhaseKind } from '@tokkl/common/pomodoroSession';
import type { PomodoroSessionState } from './pomodoroSessionState.ts';

export const SESSION_PHASE_LABEL: Record<SessionPhaseKind, string> = {
  work: 'Work', shortRest: 'Short rest', longRest: 'Long rest',
};

export function sessionTitle(session: PomodoroSessionState, now: Date): string {
  const remaining = plannedEnd(session.phase, session.config).getTime() - now.getTime();
  const overtime = remaining < 0;
  const seconds = overtime ? Math.floor(-remaining / 1000) : Math.ceil(remaining / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return `${SESSION_PHASE_LABEL[session.phase.kind]} · ${overtime ? '+' : ''}${clock}${overtime ? ' overtime' : ''} · Tokkl`;
}

import type { Response, Router } from 'express';
import type { Deps } from './context.ts';
import { createRouter } from '../http/router.ts';
import { readJson } from '../http/request.ts';
import {
  parseEditTimer,
  parseRevision,
  parseStartPomodoro,
  parseStartTimer,
  parseStopTimer,
} from '../commands/timers.ts';
export function timerRoutes(deps: Pick<Deps, 'auth' | 'timersFor' | 'openTimerStream'>): Router {
  const api = createRouter(),
    auth = deps.auth.requireAuth;
  const timers = (res: Response) => deps.timersFor(res.locals.auth);
  api.get('/timer', auth, async (_req, res) => res.json(await timers(res).getTimerState(res.locals.auth.user.id)));
  api.get('/timer/events', auth, async (_req, res) => {
    await deps.openTimerStream(res.locals.auth, res);
  });
  api.post('/timer/start', auth, async (req, res) =>
    res.json(await timers(res).startTimer(res.locals.auth.user.id, parseStartTimer(readJson(req)))),
  );
  api.post('/timer/stop', auth, async (req, res) => {
    const { revision, stop } = parseStopTimer(readJson(req));
    res.json(await timers(res).stopTimer(res.locals.auth.user.id, revision, stop));
  });
  api.post('/timer/edit', auth, async (req, res) =>
    res.json(await timers(res).editTimer(res.locals.auth.user.id, parseEditTimer(readJson(req)))),
  );
  api.post('/timer/pause', auth, async (_req, res) => res.json(await timers(res).pauseTimer(res.locals.auth.user.id)));
  api.post('/timer/resume', auth, async (req, res) =>
    res.json(await timers(res).resumeTimer(res.locals.auth.user.id, parseRevision(readJson(req).revision))),
  );
  api.post('/timer/discard', auth, async (req, res) =>
    res.json(await timers(res).discardPause(res.locals.auth.user.id, parseRevision(readJson(req).revision))),
  );
  api.post('/pomodoro', auth, async (req, res) =>
    res.json(await timers(res).startPomodoro(res.locals.auth.user.id, parseStartPomodoro(readJson(req)))),
  );
  api.post('/pomodoro/next', auth, async (req, res) =>
    res.json(await timers(res).nextPomodoroPhase(res.locals.auth.user.id, parseRevision(readJson(req).revision))),
  );
  api.post('/pomodoro/end', auth, async (req, res) =>
    res.json(await timers(res).endPomodoro(res.locals.auth.user.id, parseRevision(readJson(req).revision))),
  );
  return api;
}

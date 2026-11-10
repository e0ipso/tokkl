import type { Request, Response, Router } from 'express';
import type { Deps } from './context.ts';
import { createRouter } from '../http/router.ts';
import { readIdempotencyClaim, readJson, readOptionalJson } from '../http/request.ts';
import { BoundedCache } from '../lib/boundedCache.ts';
import {
  OPTIONAL_REVISION_ACTIONS,
  parseEditTimer,
  parsePauseTimer,
  parseRevision,
  parseStartPomodoro,
  parseStartTimer,
  parseStopTimer,
  type OptionalRevisionAction,
} from '../commands/timers.ts';

const REVISIONLESS_LOG_INTERVAL_MS = 60 * 60 * 1000;
/** Past that the least recent may be logged again early. */
const REVISIONLESS_AGENTS = 1000;
/** As sessions store it. */
const USER_AGENT_LENGTH = 255;

/** At info level, at most once per interval per user agent and action. The user agent is the only header logged. */
function revisionlessLogger() {
  const lastLogged = new BoundedCache<string, number>(REVISIONLESS_AGENTS);
  return (req: Request, res: Response, action: OptionalRevisionAction) => {
    const userAgent = (req.get('user-agent') ?? '').slice(0, USER_AGENT_LENGTH);
    const key = `${action}\n${userAgent}`;
    const last = lastLogged.get(key);
    const now = Date.now();
    if (last !== undefined && now - last < REVISIONLESS_LOG_INTERVAL_MS) return;
    lastLogged.set(key, now);
    res.locals.log.info('Timer action without revision', {
      action,
      capability: OPTIONAL_REVISION_ACTIONS[action],
      userAgent,
    });
  };
}

export function timerRoutes(deps: Pick<Deps, 'auth' | 'timersFor' | 'openTimerStream'>): Router {
  const api = createRouter(),
    auth = deps.auth.requireAuth;
  const revisionless = revisionlessLogger();
  const timers = (res: Response) => deps.timersFor(res.locals.auth);
  api.get('/timer', auth, async (_req, res) => res.json(await timers(res).getTimerState()));
  api.get('/timer/events', auth, async (_req, res) => {
    await deps.openTimerStream(res.locals.auth, res);
  });
  api.post('/timer/start', auth, async (req, res) => {
    const start = { ...parseStartTimer(readJson(req)), idempotency: readIdempotencyClaim(req) };
    res.json(await timers(res).startTimer(start));
  });
  api.post('/timer/stop', auth, async (req, res) => {
    const { revision, stop } = parseStopTimer(readJson(req));
    res.json(await timers(res).stopTimer(revision, stop));
  });
  api.post('/timer/edit', auth, async (req, res) =>
    res.json(await timers(res).editTimer(parseEditTimer(readJson(req)))),
  );
  api.post('/timer/pause', auth, async (req, res) => {
    const { revision } = parsePauseTimer(readOptionalJson(req));
    if (revision === undefined) revisionless(req, res, 'POST /api/app/timer/pause');
    res.json(await timers(res).pauseTimer(revision));
  });
  api.post('/timer/resume', auth, async (req, res) =>
    res.json(await timers(res).resumeTimer(parseRevision(readJson(req).revision))),
  );
  api.post('/timer/discard', auth, async (req, res) =>
    res.json(await timers(res).discardPause(parseRevision(readJson(req).revision))),
  );
  api.post('/pomodoro', auth, async (req, res) => {
    const start = { ...parseStartPomodoro(readJson(req)), idempotency: readIdempotencyClaim(req) };
    if (start.revision === undefined) revisionless(req, res, 'POST /api/app/pomodoro');
    res.json(await timers(res).startPomodoro(start));
  });
  api.post('/pomodoro/next', auth, async (req, res) =>
    res.json(await timers(res).nextPomodoroPhase(parseRevision(readJson(req).revision))),
  );
  api.post('/pomodoro/end', auth, async (req, res) =>
    res.json(await timers(res).endPomodoro(parseRevision(readJson(req).revision))),
  );
  return api;
}

import type { Router } from 'express';
import type { Deps } from '../context.ts';
import { createRouter } from '../../http/router.ts';
import { catalogRoutes } from './catalog.ts';
import { meRoutes } from './me.ts';
import { timeEntryRoutes } from './timeEntries.ts';
import { workspaceRoutes } from './workspaces.ts';

/** The Toggl Track API v9 subset Tokkl serves under `/api/v9`. Every route needs a signed-in user. */
export function togglV9Routes(deps: Deps): Router {
  const api = createRouter();
  api.use(deps.auth.requireAuth);
  api.use(meRoutes(deps), workspaceRoutes(deps), timeEntryRoutes(deps), catalogRoutes(deps));
  return api;
}

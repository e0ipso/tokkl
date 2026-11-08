/** The API version and capabilities this server announces in `GET /api/v9/me`. */
import type { ServerApi, ServerCapability } from '@tokkl/types';

const CAPABILITIES: readonly ServerCapability[] = Object.freeze([
  'app-preferences',
  'timer-actions',
  'timer-edit',
  'pomodoro-revision',
]);

/** Fresh on each call, so no reply shares an array another one could change. */
export function presentServerApi(): ServerApi {
  return { api_version: 1, capabilities: [...CAPABILITIES] };
}

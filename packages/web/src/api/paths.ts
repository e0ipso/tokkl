/** Base paths of the server's two APIs: the Toggl-compatible v9 API and the app's own. */
export const V9 = '/api/v9';
export const APP = '/api/app';

/** Workspace-scoped path builder: `wsPath(wid, 'projects', 3)` gives `/api/v9/workspaces/{wid}/projects/3`. */
export function wsPath(wid: number, ...segments: Array<string | number>): string {
  return [`${V9}/workspaces/${wid}`, ...segments].join('/');
}

import { use, type ComponentType } from 'react';
import { loadPageModule } from './pageLoad.ts';

/**
 * Pages that load their code on first visit. The timer page, the one every sign-in opens, stays in
 * the main bundle; the rest each get a chunk. Every stylesheet is imported once by styles.css, so a
 * chunk carries no CSS and loading one never changes the cascade.
 */

interface LazyPage {
  /** Renders the page once its module has loaded; until then it suspends to the shell's fallback. */
  Page: ComponentType;
  /** Starts loading the module, or loads it again after a failure. */
  prefetch: () => void;
  /** Forgets a failed load, so the next render loads the module again. */
  forgetFailure: () => void;
}

type Attempt =
  | { status: 'pending'; promise: Promise<ComponentType> }
  | { status: 'loaded'; component: ComponentType }
  /** `final` when a visit's load failed; a failed prefetch, which may not reload, leaves the visit its own try. */
  | { status: 'failed'; error: unknown; final: boolean };

/**
 * Wraps a page module's loader. A load goes through `loadPageModule`, which retries it and, when
 * the page is being visited, reloads the tab once (after a deploy the old chunk files are gone). A
 * prefetch never reloads; the visit after a failed prefetch gets its own try. A visit's load that
 * still fails stays failed, so the route's error boundary shows it instead of retrying on every
 * render, until Try again (`retryFailedPages`) or the next `prefetch` loads it again.
 */
function lazyPage(load: () => Promise<ComponentType>): LazyPage {
  let attempt: Attempt | null = null;
  const start = (visit: boolean): Attempt => {
    if (attempt && attempt.status !== 'failed') return attempt;
    if (attempt?.final && visit) return attempt;
    const promise = loadPageModule(load, { mayReload: visit }).then(
      component => {
        attempt = { status: 'loaded', component };
        return component;
      },
      (error: unknown) => {
        attempt = { status: 'failed', error, final: visit };
        throw error;
      },
    );
    // The failure is shown by the page's render; this only keeps a prefetch from reporting it unhandled.
    promise.catch(() => {});
    const pending: Attempt = { status: 'pending', promise };
    attempt = pending;
    return pending;
  };

  function Page() {
    const current = start(true);
    if (current.status === 'failed') throw current.error;
    const Loaded = current.status === 'loaded' ? current.component : use(current.promise);
    return <Loaded />;
  }

  return {
    Page,
    prefetch: () => {
      start(false);
    },
    forgetFailure: () => {
      if (attempt?.status === 'failed') attempt = null;
    },
  };
}

const pomodoro = lazyPage(() => import('../pages/PomodoroPage.tsx').then(module => module.PomodoroPage));
const reports = lazyPage(() => import('../pages/ReportsPage.tsx').then(module => module.ReportsPage));
const projects = lazyPage(() => import('../pages/ProjectsPage.tsx').then(module => module.ProjectsPage));
const clients = lazyPage(() => import('../pages/ClientsPage.tsx').then(module => module.ClientsPage));
const tags = lazyPage(() => import('../pages/TagsPage.tsx').then(module => module.TagsPage));
const trash = lazyPage(() => import('../pages/TrashPage.tsx').then(module => module.TrashPage));
const settings = lazyPage(() => import('../pages/SettingsPage.tsx').then(module => module.SettingsPage));
const admin = lazyPage(() => import('../pages/AdminPage.tsx').then(module => module.AdminPage));

export const PomodoroPage = pomodoro.Page;
export const ReportsPage = reports.Page;
export const ProjectsPage = projects.Page;
export const ClientsPage = clients.Page;
export const TagsPage = tags.Page;
export const TrashPage = trash.Page;
export const SettingsPage = settings.Page;
export const AdminPage = admin.Page;

const BY_HREF: Readonly<Record<string, LazyPage>> = {
  '/pomodoro': pomodoro,
  '/reports': reports,
  '/projects': projects,
  '/clients': clients,
  '/tags': tags,
  '/trash': trash,
  '/settings': settings,
  '/admin': admin,
};

/** Lets every page whose load failed load again on its next render: the error screen's Try again. */
export function retryFailedPages(): void {
  for (const page of Object.values(BY_HREF)) page.forgetFailure();
}

/** Starts loading the page a navigation link opens, so the click right after renders it at once. */
export function prefetchPage(href: string): void {
  BY_HREF[href]?.prefetch();
}

import { use, type ComponentType } from 'react';

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
}

type Attempt =
  | { status: 'pending'; promise: Promise<ComponentType> }
  | { status: 'loaded'; component: ComponentType }
  | { status: 'failed'; error: unknown };

/**
 * Wraps a page module's loader. A failed load stays failed, so the route's error boundary shows it
 * instead of retrying on every render, until the next `prefetch`: hovering, focusing or clicking a
 * navigation link loads it again.
 */
function lazyPage(load: () => Promise<ComponentType>): LazyPage {
  let attempt: Attempt | null = null;
  const start = (): Attempt => {
    if (attempt && attempt.status !== 'failed') return attempt;
    const promise = load().then(
      component => {
        attempt = { status: 'loaded', component };
        return component;
      },
      (error: unknown) => {
        attempt = { status: 'failed', error };
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
    const current = attempt ?? start();
    if (current.status === 'failed') throw current.error;
    const Loaded = current.status === 'loaded' ? current.component : use(current.promise);
    return <Loaded />;
  }

  return {
    Page,
    prefetch: () => {
      start();
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

/** Starts loading the page a navigation link opens, so the click right after renders it at once. */
export function prefetchPage(href: string): void {
  BY_HREF[href]?.prefetch();
}

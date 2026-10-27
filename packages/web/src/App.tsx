import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, Route, Switch, useLocation, useRoute } from 'wouter';
import { ApiError, api } from './api/client.ts';
import { useCurrentEntry, useMe, usePreferences } from './api/hooks.ts';
import { TimerStateProvider } from './api/TimerStateProvider.tsx';
import { Brand } from './components/Brand.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { Icon, type IconName } from './components/Icon.tsx';
import { LoadError, Loading } from './components/PageState.tsx';
import { PauseCoordinationProvider } from './components/PauseCoordination.tsx';
import { PomodoroSessionBanner } from './components/PomodoroSessionBanner.tsx';
import { sessionTitle } from './components/pomodoroSessionPresentation.ts';
import { PomodoroSessionProvider, usePomodoroSession } from './components/PomodoroSessionProvider.tsx';
import { LongTimerReminder } from './components/LongTimerReminder.tsx';
import { useToast } from './components/Toast.tsx';
import { formatDuration } from '@tokkl/common/duration';
import { entrySeconds, useNow } from './lib/settings.ts';
import { endSession, logOut, takeLogoutFailure } from './lib/session.ts';
import { applyTheme } from './lib/theme.ts';
import { useMediaQuery } from './lib/useMediaQuery.ts';
import { AdminPage } from './pages/AdminPage.tsx';
import { AuthPage } from './pages/AuthPage.tsx';
import { InvitePage } from './pages/InvitePage.tsx';
import { ResetPasswordPage } from './pages/ResetPasswordPage.tsx';
import { ClientsPage } from './pages/ClientsPage.tsx';
import { ProjectsPage } from './pages/ProjectsPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { TagsPage } from './pages/TagsPage.tsx';
import { TimerPage } from './pages/TimerPage.tsx';
import { PomodoroPage } from './pages/PomodoroPage.tsx';
import { TrashPage } from './pages/TrashPage.tsx';

/** A section's hue: styles.css maps each to a fill and the text colour on it (data-section). */
type Section = 'timer' | 'pomodoro' | 'reports' | 'projects' | 'settings' | 'more';

type NavItem = { href: string; label: string; icon: IconName; section: Section; inMore?: true; adminOnly?: true };

/**
 * Every page in the navigation. On phones the inMore items move from the bottom bar into the More
 * sheet. Reports keeps its own hue there; the other inMore items take More's. adminOnly items show
 * only to admins; the server still refuses everyone else.
 */
const NAV: NavItem[] = [
  { href: '/', label: 'Timer', icon: 'timer', section: 'timer' },
  { href: '/pomodoro', label: 'Pomodoro', icon: 'tomato', section: 'pomodoro' },
  { href: '/reports', label: 'Reports', icon: 'chart', section: 'reports', inMore: true },
  { href: '/projects', label: 'Projects', icon: 'folder', section: 'projects' },
  { href: '/clients', label: 'Clients', icon: 'users', section: 'more', inMore: true },
  { href: '/tags', label: 'Tags', icon: 'tag', section: 'more', inMore: true },
  { href: '/trash', label: 'Trash', icon: 'trash', section: 'more', inMore: true },
  { href: '/admin', label: 'Admin', icon: 'shield', section: 'more', inMore: true, adminOnly: true },
  { href: '/settings', label: 'Settings', icon: 'settings', section: 'settings' },
];

/** The phone breakpoint; styles.css uses the same max-width for the bottom bar. */
const PHONE_QUERY = '(max-width: 760px)';

/**
 * Applies the saved theme once preferences load. Until then the cached theme stays:
 * packages/web/public/theme-boot.js puts it on <html> before the first paint, and lib/theme.ts
 * applies it again when it loads.
 */
function useTheme() {
  const { data: prefs } = usePreferences();
  const theme = prefs ? (prefs.theme ?? 'system') : undefined;
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);
}

/** Shows the running time in the tab title, like Toggl's "show running time in the title bar". */
function useRunningTitle() {
  const { data: current } = useCurrentEntry();
  const now = useNow(1000);
  // A session's countdown runs on the server's clock, like the Pomodoro page's.
  const { session, now: serverNow } = usePomodoroSession();
  useEffect(() => {
    document.title = session ? sessionTitle(session, serverNow) : current
      ? `${formatDuration(entrySeconds(current, now))} · ${current.description || 'Running'}`
      : 'Tokkl';
  }, [current, session, now, serverNow]);
}

/**
 * The phone's More sheet: a modal dialog over the bottom bar. Focus starts on its first link and Tab
 * cycles inside it. Escape, the close button and a tap on the backdrop all close it; the caller
 * moves focus back to the More button.
 */
function MoreSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('a[href]')?.focus();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button')];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  return (
    <>
      <div className="more-backdrop" onClick={onClose} />
      <div ref={ref} className="more-sheet" role="dialog" aria-modal="true" aria-label="More" onKeyDown={onKeyDown}>
        <div className="more-sheet-head">
          <h2>More</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

/**
 * Who is signed in, shown beside Log out so a shared browser shows whose account is open. Reads
 * the /me query the auth gate already loaded. Long values are cut with an ellipsis and keep the
 * full text in title; with no full name the email stands alone.
 */
function SignedInUser() {
  const { data: me } = useMe();
  if (!me) return null;
  const name = me.fullname.trim();
  return (
    <div className="signed-in">
      <span className="visually-hidden">Signed in as </span>
      {name ? <span className="signed-in-name" title={name}>{name}</span> : null}
      <span className="signed-in-email" title={me.email}>{me.email}</span>
    </div>
  );
}

function Shell() {
  const [location] = useLocation();
  const qc = useQueryClient();
  const { data: current } = useCurrentEntry();
  const { data: me } = useMe();
  const { session } = usePomodoroSession();
  const phone = useMediaQuery(PHONE_QUERY);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const toast = useToast();
  useTheme();
  useRunningTitle();

  // Leaving the phone layout removes the More button, so the sheet must not reopen on the way back.
  useEffect(() => {
    if (!phone) setMoreOpen(false);
  }, [phone]);

  // The tab forgets the session even when the request fails. The new page load then shows what
  // the server says: the login page, or this account if the server still holds the session.
  const logout = () => {
    logOut(qc)
      .catch(() => {})
      .finally(() => {
        window.location.href = '/';
      });
  };

  // This account loaded after a failed logout, from here or from Settings. Say so, so nobody on a
  // shared browser walks away thinking they logged out.
  useEffect(() => {
    if (!takeLogoutFailure()) return;
    toast.show('Log out failed. You are still signed in.', {
      kind: 'error',
      action: { label: 'Try again', run: logout },
      durationMs: 60_000,
    });
    // Runs once per page load; the first read clears the flag.
  }, []);

  const closeMore = () => {
    setMoreOpen(false);
    moreButton.current?.focus();
  };

  const isActive = (href: string) => (href === '/' ? location === '/' : location.startsWith(href));

  const navLink = (item: NavItem, onClick?: () => void) => {
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`nav-link${active ? ' active' : ''}`}
        data-section={item.section}
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
      >
        <Icon name={item.icon} className="nav-icon" />
        <span>{item.label}</span>
        {/* A session's open pomodoro is the running entry; the session's own marker stands for it. */}
        {item.href === '/' && current && !session ? (
          <span className="running-dot" title="Timer running"><span className="visually-hidden">Timer running</span></span>
        ) : null}
        {item.href === '/pomodoro' && session ? (
          <span className="running-dot" title="Pomodoro session running"><span className="visually-hidden">Pomodoro session running</span></span>
        ) : null}
      </Link>
    );
  };

  const logoutButton = (
    <button type="button" className="nav-link" onClick={logout}>
      <Icon name="logout" className="nav-icon" />
      <span>Log out</span>
    </button>
  );

  const nav = NAV.filter((item) => !item.adminOnly || me?.role === 'admin');
  const moreItems = nav.filter((item) => item.inMore);
  // The open page under More, whose hue the More button takes so the button and the page agree.
  const moreCurrent = moreItems.find((item) => isActive(item.href));
  // The open page's section hue; pages read it for their stickers. Every route is in NAV, Admin too.
  const section = NAV.find((item) => isActive(item.href))?.section ?? 'timer';

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        {phone ? (
          <>
            {nav.filter((item) => !item.inMore).map((item) => navLink(item))}
            <button
              ref={moreButton}
              type="button"
              className={`nav-link${moreCurrent ? ' active' : ''}`}
              data-section={moreCurrent?.section ?? 'more'}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <Icon name="more" className="nav-icon" />
              <span>More</span>
            </button>
            {moreOpen ? (
              <MoreSheet onClose={closeMore}>
                {moreItems.map((item) => navLink(item, closeMore))}
                <SignedInUser />
                {logoutButton}
              </MoreSheet>
            ) : null}
          </>
        ) : (
          <>
            <Brand />
            {nav.map((item) => navLink(item))}
            <span className="spacer" />
            <SignedInUser />
            {logoutButton}
          </>
        )}
      </nav>
      {phone ? <header className="phone-header"><Brand size="sm" /></header> : null}
      <main className="content" data-section={section}>
        <LongTimerReminder />
        <PomodoroSessionBanner />
        <ErrorBoundary resetKey={location}>
        <Switch>
          <Route path="/" component={TimerPage} />
          <Route path="/pomodoro" component={PomodoroPage} />
          <Route path="/reports" component={ReportsPage} />
          <Route path="/projects" component={ProjectsPage} />
          <Route path="/clients" component={ClientsPage} />
          <Route path="/tags" component={TagsPage} />
          <Route path="/trash" component={TrashPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/admin" component={AdminPage} />
          <Route><Redirect to="/" /></Route>
        </Switch>
        </ErrorBoundary>
      </main>
    </div>
  );
}

/**
 * Ends the session once when /me answers 403, whether it expired while the app was open or before
 * this page load. Clearing the cache also drops the status and /me queries, which App reads, so
 * the state change re-renders App and its queries fetch again. That second 403 finds the session
 * already ended and does nothing, so the 403 path cannot clear and refetch in a loop. A successful
 * /me, after the next login, re-arms it. This runs before paint, so the login page never shows in
 * the previous user's theme.
 */
function useEndSessionOnForbidden(forbidden: boolean, signedIn: boolean) {
  const qc = useQueryClient();
  const [ended, setEnded] = useState(false);
  useLayoutEffect(() => {
    if (signedIn) {
      setEnded(false);
    } else if (forbidden && !ended) {
      endSession(qc);
      setEnded(true);
    }
  }, [forbidden, signedIn, ended, qc]);
}

export function App() {
  const status = useQuery({
    queryKey: ['status'],
    queryFn: () => api.get<{ setup_required: boolean }>('/api/app/status'),
    staleTime: Infinity,
  });
  const me = useMe();
  const forbidden = me.error instanceof ApiError && me.error.status === 403;
  useEndSessionOnForbidden(forbidden, me.isSuccess);
  const [isInvite, invite] = useRoute('/invite/:token');
  const [isReset, reset] = useRoute('/reset/:token');

  // Reachable signed in or not: accepting an invite starts the new account's session.
  if (isInvite) return <InvitePage key={invite.token} token={invite.token} />;
  // Reachable signed in or not: the person resetting has usually lost access to the account.
  if (isReset) return <ResetPasswordPage key={reset.token} token={reset.token} />;
  if (status.isLoading || (me.isLoading && !status.data?.setup_required)) {
    return <div className="splash"><Brand size="lg" /><Loading /></div>;
  }
  if (status.data?.setup_required) return <AuthPage mode="setup" />;
  if (forbidden) return <AuthPage mode="login" />;
  if (me.error) {
    const retry = () => {
      if (status.error) void status.refetch();
      void me.refetch();
    };
    return (
      <div className="splash">
        <Brand size="lg" />
        <LoadError message={`Can't reach the server: ${me.error.message}`} onRetry={retry} />
      </div>
    );
  }
  return (
    <TimerStateProvider>
      <PauseCoordinationProvider><PomodoroSessionProvider><Shell /></PomodoroSessionProvider></PauseCoordinationProvider>
    </TimerStateProvider>
  );
}

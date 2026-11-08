import { Suspense, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import { version } from '../../../../package.json';
import { useMe } from '../api/account.ts';
import { useCurrentEntry } from '../api/timerHooks.ts';
import { Brand } from '../components/Brand.tsx';
import { ErrorBoundary } from '../components/ErrorBoundary.tsx';
import { Icon } from '../components/Icon.tsx';
import { LongTimerReminder } from '../components/LongTimerReminder.tsx';
import { closeModalThen } from '../components/Overlay.tsx';
import { Loading } from '../components/PageState.tsx';
import { PomodoroSessionBanner } from '../components/PomodoroSessionBanner.tsx';
import { usePomodoroSession } from '../components/PomodoroSessionProvider.tsx';
import { useToast } from '../components/Toast.tsx';
import { logOut, takeLogoutFailure } from '../lib/session.ts';
import { useMediaQuery } from '../lib/useMediaQuery.ts';
import { t } from '../i18n/messages.ts';
import { TimerPage } from '../pages/TimerPage.tsx';
import {
  AdminPage,
  ClientsPage,
  PomodoroPage,
  ProjectsPage,
  ReportsPage,
  SettingsPage,
  TagsPage,
  TrashPage,
  retryFailedPages,
} from './lazyPages.tsx';
import { MoreSheet } from './MoreSheet.tsx';
import { NAV, PHONE_QUERY, isActive, sectionOf, type NavItem } from './nav.ts';
import { NavLink, RunningTitle, SignedInUser, useTheme } from './ShellParts.tsx';

/** The tab forgets the session even when the request fails; see logOut in lib/session.ts. */
function useLogout(): () => void {
  const qc = useQueryClient();
  // The new page load then shows what the server says: the login page, or this account if the
  // server still holds the session.
  return () => {
    logOut(qc)
      .catch(() => {})
      .finally(() => {
        window.location.href = '/';
      });
  };
}

/**
 * This account loaded after a failed logout, from here or from Settings. Say so, so nobody on a
 * shared browser walks away thinking they logged out. Runs once per page load: the first read
 * clears the flag.
 */
function useLogoutFailureNotice(retry: () => void) {
  const toast = useToast();
  const notice = useEffectEvent(() => {
    if (!takeLogoutFailure()) return;
    toast.show(t('shell.logOutFailed'), {
      kind: 'error',
      action: { label: t('common.tryAgain'), run: retry },
      durationMs: 60_000,
    });
  });
  useEffect(() => notice(), []);
}

/**
 * The page for the current route. While a page's code loads, the route shows the same Loading
 * state a page shows while its data loads.
 */
function Routes() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <Loading />
        </div>
      }
    >
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
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    </Suspense>
  );
}

/** The signed-in app: navigation, the app-wide banners and the page for the current route. */
export function Shell() {
  const [location] = useLocation();
  const { data: current } = useCurrentEntry();
  const { data: me } = useMe();
  const { session } = usePomodoroSession();
  const phone = useMediaQuery(PHONE_QUERY);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const logout = useLogout();
  useTheme();
  useLogoutFailureNotice(logout);

  // Leaving the phone layout removes the More button, so the sheet must not reopen on the way back.
  if (!phone && moreOpen) setMoreOpen(false);

  const closeMore = () =>
    closeModalThen(
      () => setMoreOpen(false),
      () => moreButton.current?.focus(),
    );

  const linkProps = (item: NavItem) => ({
    item,
    active: isActive(item.href, location),
    timerRunning: Boolean(current),
    sessionRunning: Boolean(session),
  });

  const logoutButton = (
    <button type="button" className="nav-link" onClick={logout}>
      <Icon name="logout" className="nav-icon" />
      <span>{t('shell.logOut')}</span>
    </button>
  );

  const nav = NAV.filter(item => !item.adminOnly || me?.role === 'admin');
  const moreItems = nav.filter(item => item.inMore);
  // The open page under More, whose hue the More button takes so the button and the page agree.
  const moreCurrent = moreItems.find(item => isActive(item.href, location));

  return (
    <div className="shell">
      <RunningTitle />
      <nav className="sidebar" aria-label={t('shell.navLabel')}>
        {phone ? (
          <>
            {nav
              .filter(item => !item.inMore)
              .map(item => (
                <NavLink key={item.href} {...linkProps(item)} />
              ))}
            <button
              ref={moreButton}
              type="button"
              className={`nav-link${moreCurrent ? ' active' : ''}`}
              data-section={moreCurrent?.section ?? 'more'}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(open => !open)}
            >
              <Icon name="more" className="nav-icon" />
              <span>{t('shell.more')}</span>
            </button>
            {moreOpen ? (
              <MoreSheet onClose={closeMore}>
                {moreItems.map(item => (
                  <NavLink key={item.href} {...linkProps(item)} onNavigate={closeMore} />
                ))}
                <SignedInUser />
                {logoutButton}
                <div className="app-version">{t('shell.version', { version })}</div>
              </MoreSheet>
            ) : null}
          </>
        ) : (
          <>
            <Brand />
            {nav.map(item => (
              <NavLink key={item.href} {...linkProps(item)} />
            ))}
            <span className="spacer" />
            <SignedInUser />
            {logoutButton}
            <div className="app-version">{t('shell.version', { version })}</div>
          </>
        )}
      </nav>
      {phone ? (
        <header className="phone-header">
          <Brand size="sm" />
        </header>
      ) : null}
      <main className="content" data-section={sectionOf(location)}>
        <LongTimerReminder />
        <PomodoroSessionBanner />
        <ErrorBoundary resetKey={location} onRetry={retryFailedPages}>
          <Routes />
        </ErrorBoundary>
      </main>
    </div>
  );
}

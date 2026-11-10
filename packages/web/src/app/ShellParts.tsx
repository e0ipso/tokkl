import { useEffect } from 'react';
import { Link } from 'wouter';
import { formatDuration } from '@tokkl/common/duration';
import { useMe, usePreferences } from '../api/account.ts';
import { useCurrentEntry, useServerNow } from '../api/timerHooks.ts';
import { Icon } from '../components/Icon.tsx';
import { t } from '../i18n/messages.ts';
import { sessionTitle } from '../components/pomodoroSessionPresentation.ts';
import { usePomodoroSession } from '../components/PomodoroSessionProvider.tsx';
import { useNow } from '../lib/clock.ts';
import { entrySeconds } from '../lib/snapping.ts';
import { applyTheme } from '../lib/theme.ts';
import { prefetchPage } from './lazyPages.tsx';
import type { NavItem } from './nav.ts';

/** Until preferences load, the cached theme from public/theme-boot.js and lib/theme.ts stays. */
export function useTheme() {
  const { data: prefs } = usePreferences();
  const theme = prefs ? (prefs.theme ?? 'system') : undefined;
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);
}

/** The only part of the shell that ticks every second. A session's countdown runs on the server's clock. */
export function RunningTitle() {
  const { data: current } = useCurrentEntry();
  const now = useNow(1000);
  const serverNow = useServerNow(1000);
  const { session } = usePomodoroSession();
  useEffect(() => {
    document.title = session
      ? sessionTitle(session, serverNow)
      : current
        ? t('shell.runningTitle', {
            duration: formatDuration(entrySeconds(current, now)),
            description: current.description || t('shell.runningUntitled'),
          })
        : t('shell.appName');
  }, [current, session, now, serverNow]);
  return null;
}

/** Shows whose account is open on a shared browser. Long values are cut and keep the full text in title. */
export function SignedInUser() {
  const { data: me } = useMe();
  if (!me) return null;
  const name = me.fullname.trim();
  return (
    <div className="signed-in">
      <span className="visually-hidden">{t('shell.signedInAs')}</span>
      {name ? (
        <span className="signed-in-name" title={name}>
          {name}
        </span>
      ) : null}
      <span className="signed-in-email" title={me.email}>
        {me.email}
      </span>
    </div>
  );
}

/** With a dot while the timer or a Pomodoro session runs. */
export function NavLink({
  item,
  active,
  timerRunning,
  sessionRunning,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  timerRunning: boolean;
  sessionRunning: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      className={`nav-link${active ? ' active' : ''}`}
      data-section={item.section}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      onPointerEnter={() => prefetchPage(item.href)}
      onFocus={() => prefetchPage(item.href)}
    >
      <Icon name={item.icon} className="nav-icon" />
      <span>{t(item.label)}</span>
      {/* A session's open pomodoro is the running entry; the session's own marker stands for it. */}
      {item.href === '/' && timerRunning && !sessionRunning ? (
        <span className="running-dot" title={t('shell.timerRunning')}>
          <span className="visually-hidden">{t('shell.timerRunning')}</span>
        </span>
      ) : null}
      {item.href === '/pomodoro' && sessionRunning ? (
        <span className="running-dot" title={t('shell.sessionRunning')}>
          <span className="visually-hidden">{t('shell.sessionRunning')}</span>
        </span>
      ) : null}
    </Link>
  );
}

import { useEffect } from 'react';
import { Link } from 'wouter';
import { formatDuration } from '@tokkl/common/duration';
import { useMe, usePreferences } from '../api/account.ts';
import { useCurrentEntry } from '../api/entries.ts';
import { useServerNow } from '../api/timerHooks.ts';
import { Icon } from '../components/Icon.tsx';
import { t } from '../i18n/messages.ts';
import { sessionTitle } from '../components/pomodoroSessionPresentation.ts';
import { usePomodoroSession } from '../components/PomodoroSessionProvider.tsx';
import { useNow } from '../lib/clock.ts';
import { entrySeconds } from '../lib/snapping.ts';
import { applyTheme } from '../lib/theme.ts';
import type { NavItem } from './nav.ts';

/**
 * Applies the saved theme once preferences load. Until then the cached theme stays:
 * packages/web/public/theme-boot.js puts it on <html> before the first paint, and lib/theme.ts
 * applies it again when it loads.
 */
export function useTheme() {
  const { data: prefs } = usePreferences();
  const theme = prefs ? (prefs.theme ?? 'system') : undefined;
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);
}

/**
 * Shows the running time in the tab title, like Toggl's "show running time in the title bar". It
 * renders nothing and is the only part of the shell that ticks every second. A session's countdown
 * runs on the server's clock, like the Pomodoro page's.
 */
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

/**
 * Who is signed in, shown beside Log out so a shared browser shows whose account is open. Reads
 * the /me query the auth gate already loaded. Long values are cut with an ellipsis and keep the
 * full text in title; with no full name the email stands alone.
 */
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

/** One navigation link, with a dot while the timer or a Pomodoro session runs. */
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

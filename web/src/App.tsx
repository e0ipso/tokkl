import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, Route, Switch, useLocation } from 'wouter';
import { ApiError, api } from './api/client.ts';
import { useCurrentEntry, useMe, usePreferences } from './api/hooks.ts';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { Icon, type IconName } from './components/Icon.tsx';
import { formatDuration } from '../../shared/duration.ts';
import { entrySeconds, useNow } from './lib/settings.ts';
import { AuthPage } from './pages/AuthPage.tsx';
import { ClientsPage } from './pages/ClientsPage.tsx';
import { ProjectsPage } from './pages/ProjectsPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { TagsPage } from './pages/TagsPage.tsx';
import { TimerPage } from './pages/TimerPage.tsx';
import { TrashPage } from './pages/TrashPage.tsx';

const NAV: Array<{ href: string; label: string; icon: IconName }> = [
  { href: '/', label: 'Timer', icon: 'timer' },
  { href: '/reports', label: 'Reports', icon: 'chart' },
  { href: '/projects', label: 'Projects', icon: 'folder' },
  { href: '/clients', label: 'Clients', icon: 'users' },
  { href: '/tags', label: 'Tags', icon: 'tag' },
  { href: '/trash', label: 'Trash', icon: 'trash' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

function useTheme() {
  const { data: prefs } = usePreferences();
  const theme = prefs?.theme ?? 'system';
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
}

/** Shows the running time in the tab title, like Toggl's "show running time in the title bar". */
function useRunningTitle() {
  const { data: current } = useCurrentEntry();
  const now = useNow(1000);
  useEffect(() => {
    document.title = current
      ? `${formatDuration(entrySeconds(current, now))} · ${current.description || 'Running'}`
      : 'Timetrack';
  }, [current, now]);
}

function Shell() {
  const [location] = useLocation();
  const qc = useQueryClient();
  const { data: current } = useCurrentEntry();
  useTheme();
  useRunningTitle();

  const logout = async () => {
    await api.post('/api/app/logout');
    qc.clear();
    window.location.href = '/';
  };

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span>Timetrack</span>
        </div>
        {NAV.map((item) => {
          const active = item.href === '/' ? location === '/' : location.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={`nav-link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.href === '/' && current ? <span className="running-dot" title="Timer running" /> : null}
            </Link>
          );
        })}
        <span className="spacer" />
        <button type="button" className="nav-link" onClick={() => void logout()}>
          <Icon name="logout" />
          <span>Log out</span>
        </button>
      </nav>
      <main className="content">
        <ErrorBoundary resetKey={location}>
        <Switch>
          <Route path="/" component={TimerPage} />
          <Route path="/reports" component={ReportsPage} />
          <Route path="/projects" component={ProjectsPage} />
          <Route path="/clients" component={ClientsPage} />
          <Route path="/tags" component={TagsPage} />
          <Route path="/trash" component={TrashPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route><Redirect to="/" /></Route>
        </Switch>
        </ErrorBoundary>
      </main>
    </div>
  );
}

export function App() {
  const status = useQuery({
    queryKey: ['status'],
    queryFn: () => api.get<{ setup_required: boolean }>('/api/app/status'),
    staleTime: Infinity,
  });
  const me = useMe();

  if (status.isLoading || (me.isLoading && !status.data?.setup_required)) {
    return <div className="splash">Loading…</div>;
  }
  if (status.data?.setup_required) return <AuthPage mode="setup" />;
  if (me.error instanceof ApiError && me.error.status === 403) return <AuthPage mode="login" />;
  if (me.error) return <div className="splash">Can't reach the server: {me.error.message}</div>;
  return <Shell />;
}

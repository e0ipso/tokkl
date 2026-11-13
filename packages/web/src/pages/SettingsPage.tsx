import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Route, Switch } from 'wouter';
import { useMe, usePreferences, useWorkspace } from '../api/account.ts';
import { usePomodoroLimits } from '../api/auth.ts';
import { Icon } from '../components/Icon.tsx';
import { LoadError, Loading } from '../components/PageState.tsx';
import { logOut } from '../lib/session.ts';
import { ApiTokenSection } from './manage/settings/ApiTokenSection.tsx';
import { DataSection } from './manage/settings/DataSection.tsx';
import { PasswordSection } from './manage/settings/PasswordSection.tsx';
import { PreferencesSection } from './manage/settings/PreferencesSection.tsx';
import { ProfileSection } from './manage/settings/ProfileSection.tsx';
import { SettingsCard } from './manage/settings/SettingsCard.tsx';
import { SettingsNav, SettingsRedirect } from './manage/settings/SettingsNav.tsx';
import { WorkspaceSection } from './manage/settings/WorkspaceSection.tsx';
import { t } from '../i18n/messages.ts';

const SECTIONS = [
  ['profile', 'settings.sectionProfile'],
  ['password', 'settings.sectionPassword'],
  ['preferences', 'settings.sectionPreferences'],
  ['workspace', 'settings.sectionWorkspace'],
  ['api-token', 'settings.sectionApiToken'],
  ['data', 'settings.sectionData'],
  ['session', 'settings.sectionSession'],
] as const;

function SessionSection() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  // Like the sidebar button: the tab forgets the session even when the request fails.
  const logout = () => {
    setBusy(true);
    logOut(qc)
      .catch(() => {})
      .finally(() => window.location.reload());
  };
  return (
    <SettingsCard id="session" title={t('settings.sectionSession')} intro={t('settings.sessionIntro')}>
      <button type="button" className="button button-ghost" disabled={busy} onClick={logout}>
        <Icon name="logout" size={16} /> {t('shell.logOut')}
      </button>
    </SettingsCard>
  );
}

function PreferencesPage() {
  const { data: prefs, error: prefsError, refetch: refetchPrefs } = usePreferences();
  const { data: limits, error: limitsError, refetch: refetchLimits } = usePomodoroLimits();
  const error = prefsError ?? limitsError;
  const retry = () => {
    if (prefsError) void refetchPrefs();
    if (limitsError) void refetchLimits();
  };
  if (prefs && limits) return <PreferencesSection prefs={prefs} limits={limits} />;
  return (
    <SettingsCard id="preferences" title={t('settings.sectionPreferences')}>
      {error ? (
        <LoadError
          message={t('settings.preferencesLoadFailed', { message: error.message })}
          onRetry={retry}
          className="is-compact"
        />
      ) : (
        <Loading label={t('settings.loadingPreferences')} className="is-compact" />
      )}
    </SettingsCard>
  );
}

function WorkspacePage() {
  const { data: workspace, error, refetch } = useWorkspace();
  if (workspace) return <WorkspaceSection workspace={workspace} />;
  return (
    <SettingsCard id="workspace" title={t('settings.sectionWorkspace')}>
      {error ? (
        <LoadError
          message={t('settings.workspaceLoadFailed', { message: error.message })}
          onRetry={() => void refetch()}
          className="is-compact"
        />
      ) : (
        <Loading label={t('settings.loadingWorkspace')} className="is-compact" />
      )}
    </SettingsCard>
  );
}

export function SettingsPage() {
  const { data: me } = useMe();
  return (
    <div className="page manage-page settings-page">
      <header className="page-header">
        <h1>{t('settings.title')}</h1>
      </header>
      <SettingsNav base="/settings" sections={SECTIONS} label={t('settings.sectionsLabel')} />
      <Switch>
        <Route path="/settings/profile">{me ? <ProfileSection me={me} /> : null}</Route>
        <Route path="/settings/password" component={PasswordSection} />
        <Route path="/settings/preferences" component={PreferencesPage} />
        <Route path="/settings/workspace" component={WorkspacePage} />
        <Route path="/settings/api-token">{me ? <ApiTokenSection me={me} /> : null}</Route>
        <Route path="/settings/data">{me ? <DataSection timeZone={me.timezone} /> : null}</Route>
        <Route path="/settings/session" component={SessionSection} />
        <Route>
          <SettingsRedirect base="/settings" sections={SECTIONS} />
        </Route>
      </Switch>
    </div>
  );
}

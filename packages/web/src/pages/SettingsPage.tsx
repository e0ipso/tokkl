import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe, usePreferences, useWorkspace } from '../api/hooks.ts';
import { Icon } from '../components/Icon.tsx';
import { LoadError, Loading } from '../components/PageState.tsx';
import { logOut } from '../lib/session.ts';
import { ApiTokenSection } from './manage/settings/ApiTokenSection.tsx';
import { DataSection } from './manage/settings/DataSection.tsx';
import { PasswordSection } from './manage/settings/PasswordSection.tsx';
import { PreferencesSection } from './manage/settings/PreferencesSection.tsx';
import { ProfileSection } from './manage/settings/ProfileSection.tsx';
import { SettingsCard } from './manage/settings/SettingsCard.tsx';
import { WorkspaceSection } from './manage/settings/WorkspaceSection.tsx';
import './manage/manage.css';

const SECTIONS = [
  ['profile', 'Profile'],
  ['password', 'Password'],
  ['preferences', 'Preferences'],
  ['workspace', 'Workspace'],
  ['api-token', 'API token'],
  ['data', 'Data'],
  ['session', 'Session'],
] as const;

function SessionSection() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  // Like the sidebar button: the tab forgets the session even when the request fails, and the
  // reload shows what the server says.
  const logout = () => {
    setBusy(true);
    logOut(qc)
      .catch(() => {})
      .finally(() => window.location.reload());
  };
  return (
    <SettingsCard id="session" title="Session" intro="Log out of this browser. To log out everywhere else, change your password.">
      <button type="button" className="button button-ghost" disabled={busy} onClick={logout}>
        <Icon name="logout" size={16} /> Log out
      </button>
    </SettingsCard>
  );
}

export function SettingsPage() {
  const { data: me } = useMe();
  const { data: prefs, error: prefsError, refetch: refetchPrefs } = usePreferences();
  const { data: workspace, error: workspaceError, refetch: refetchWorkspace } = useWorkspace();

  return (
    <div className="page manage-page settings-page">
      <header className="page-header">
        <h1>Settings</h1>
      </header>
      <nav className="settings-nav" aria-label="Settings sections">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </nav>

      {me ? <ProfileSection me={me} /> : null}
      <PasswordSection />
      {prefs ? <PreferencesSection prefs={prefs} /> : (
        <SettingsCard id="preferences" title="Preferences">
          {prefsError ? (
            <LoadError message={`Could not load preferences: ${prefsError.message}`} onRetry={() => void refetchPrefs()} className="is-compact" />
          ) : <Loading label="Loading preferences…" className="is-compact" />}
        </SettingsCard>
      )}
      {workspace ? <WorkspaceSection workspace={workspace} /> : (
        <SettingsCard id="workspace" title="Workspace">
          {workspaceError ? (
            <LoadError message={`Could not load the workspace: ${workspaceError.message}`} onRetry={() => void refetchWorkspace()} className="is-compact" />
          ) : <Loading label="Loading the workspace…" className="is-compact" />}
        </SettingsCard>
      )}
      {me ? <ApiTokenSection me={me} /> : null}
      {me ? <DataSection timeZone={me.timezone} /> : null}
      <SessionSection />
    </div>
  );
}

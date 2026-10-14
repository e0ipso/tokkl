import { useState } from 'react';
import { api } from '../api/client.ts';
import { useMe, usePreferences, useWorkspace } from '../api/hooks.ts';
import { Icon } from '../components/Icon.tsx';
import { useToast } from '../components/Toast.tsx';
import { clearCachedTheme } from '../lib/theme.ts';
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
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const logout = async () => {
    setBusy(true);
    try {
      await api.post('/api/app/logout');
      clearCachedTheme();
      window.location.reload();
    } catch (error) {
      toast.error(error);
      setBusy(false);
    }
  };
  return (
    <SettingsCard id="session" title="Session" intro="Log out of this browser. To log out everywhere else, change your password.">
      <button type="button" className="button button-ghost" disabled={busy} onClick={() => void logout()}>
        <Icon name="logout" size={16} /> Log out
      </button>
    </SettingsCard>
  );
}

export function SettingsPage() {
  const { data: me } = useMe();
  const { data: prefs, error: prefsError } = usePreferences();
  const { data: workspace, error: workspaceError } = useWorkspace();

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
          <p className="hint">{prefsError ? `Could not load preferences: ${prefsError.message}` : 'Loading…'}</p>
        </SettingsCard>
      )}
      {workspace ? <WorkspaceSection workspace={workspace} /> : (
        <SettingsCard id="workspace" title="Workspace">
          <p className="hint">{workspaceError ? `Could not load the workspace: ${workspaceError.message}` : 'Loading…'}</p>
        </SettingsCard>
      )}
      {me ? <ApiTokenSection me={me} /> : null}
      {me ? <DataSection timeZone={me.timezone} /> : null}
      <SessionSection />
    </div>
  );
}

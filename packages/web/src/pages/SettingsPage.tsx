import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe, usePreferences, useWorkspace } from '../api/account.ts';
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
import { t } from '../i18n/messages.ts';
import './manage/manage.css';

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
  // Like the sidebar button: the tab forgets the session even when the request fails, and the
  // reload shows what the server says. After a failure the reloaded app says logout failed.
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

export function SettingsPage() {
  const { data: me } = useMe();
  const { data: prefs, error: prefsError, refetch: refetchPrefs } = usePreferences();
  const { data: workspace, error: workspaceError, refetch: refetchWorkspace } = useWorkspace();

  return (
    <div className="page manage-page settings-page">
      <header className="page-header">
        <h1>{t('settings.title')}</h1>
      </header>
      <nav className="settings-nav" aria-label={t('settings.sectionsLabel')}>
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {t(label)}
          </a>
        ))}
      </nav>

      {me ? <ProfileSection me={me} /> : null}
      <PasswordSection />
      {prefs ? (
        <PreferencesSection prefs={prefs} />
      ) : (
        <SettingsCard id="preferences" title={t('settings.sectionPreferences')}>
          {prefsError ? (
            <LoadError
              message={t('settings.preferencesLoadFailed', { message: prefsError.message })}
              onRetry={() => void refetchPrefs()}
              className="is-compact"
            />
          ) : (
            <Loading label={t('settings.loadingPreferences')} className="is-compact" />
          )}
        </SettingsCard>
      )}
      {workspace ? (
        <WorkspaceSection workspace={workspace} />
      ) : (
        <SettingsCard id="workspace" title={t('settings.sectionWorkspace')}>
          {workspaceError ? (
            <LoadError
              message={t('settings.workspaceLoadFailed', { message: workspaceError.message })}
              onRetry={() => void refetchWorkspace()}
              className="is-compact"
            />
          ) : (
            <Loading label={t('settings.loadingWorkspace')} className="is-compact" />
          )}
        </SettingsCard>
      )}
      {me ? <ApiTokenSection me={me} /> : null}
      {me ? <DataSection timeZone={me.timezone} /> : null}
      <SessionSection />
    </div>
  );
}

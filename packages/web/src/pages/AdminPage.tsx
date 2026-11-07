import { useMe } from '../api/account.ts';
import { useAdminUsers, useInstanceSettings } from '../api/admin.ts';
import { useSettings } from '../api/settings.ts';
import { LoadError, Loading } from '../components/PageState.tsx';
import { InstanceSettingsSection } from './admin/InstanceSettingsSection.tsx';
import { InvitesSection } from './admin/InvitesSection.tsx';
import { UsersSection } from './admin/UsersSection.tsx';
import { SettingsCard } from './manage/settings/SettingsCard.tsx';
import './manage/manage.css';

/**
 * Instance administration: accounts, invite links and instance settings. Only admins see the nav
 * entry, but the server's 403 on /api/app/admin/* is what protects the page; anyone else who opens
 * /admin gets that message.
 */

const SECTIONS = [
  ['users', 'Users'],
  ['invites', 'Invites'],
  ['instance', 'Instance settings'],
] as const;

export function AdminPage() {
  const { data: me } = useMe();
  const settings = useSettings();
  const users = useAdminUsers();
  // Wait for the users list, so a non-admin sends one refused request, not three.
  const instance = useInstanceSettings(users.isSuccess);

  const header = (
    <header className="page-header">
      <h1>Admin</h1>
    </header>
  );

  if (users.error) {
    return (
      <div className="page manage-page settings-page admin-page">
        {header}
        <LoadError message={users.error.message} onRetry={() => void users.refetch()} />
      </div>
    );
  }
  if (!users.data) {
    return (
      <div className="page manage-page settings-page admin-page">
        {header}
        <Loading label="Loading accounts…" />
      </div>
    );
  }

  return (
    <div className="page manage-page settings-page admin-page">
      {header}
      <nav className="settings-nav" aria-label="Admin sections">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>
      <UsersSection users={users.data} meId={me?.id} settings={settings} />
      <InvitesSection settings={settings} />
      {instance.data ? (
        <InstanceSettingsSection server={instance.data} />
      ) : (
        <SettingsCard id="instance" title="Instance settings">
          {instance.error ? (
            <LoadError
              message={`Could not load instance settings: ${instance.error.message}`}
              onRetry={() => void instance.refetch()}
              className="is-compact"
            />
          ) : (
            <Loading label="Loading instance settings…" className="is-compact" />
          )}
        </SettingsCard>
      )}
    </div>
  );
}

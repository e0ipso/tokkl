import { useMe } from '../api/account.ts';
import { useAdminUsers, useInstanceSettings } from '../api/admin.ts';
import { useSettings } from '../api/settings.ts';
import { LoadError, Loading } from '../components/PageState.tsx';
import { InstanceSettingsSection } from './admin/InstanceSettingsSection.tsx';
import { InvitesSection } from './admin/InvitesSection.tsx';
import { UsersSection } from './admin/UsersSection.tsx';
import { SettingsCard } from './manage/settings/SettingsCard.tsx';
import { t } from '../i18n/messages.ts';

/** The server's 403 on /api/app/admin/* is what protects the page; anyone else who opens /admin sees it. */

const SECTIONS = [
  ['users', 'admin.sectionUsers'],
  ['invites', 'admin.sectionInvites'],
  ['instance', 'admin.sectionInstance'],
] as const;

export function AdminPage() {
  const { data: me } = useMe();
  const settings = useSettings();
  const users = useAdminUsers();
  // Wait for the users list, so a non-admin sends one refused request, not three.
  const instance = useInstanceSettings(users.isSuccess);

  const header = (
    <header className="page-header">
      <h1>{t('admin.title')}</h1>
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
        <Loading label={t('admin.loadingAccounts')} />
      </div>
    );
  }

  return (
    <div className="page manage-page settings-page admin-page">
      {header}
      <nav className="settings-nav" aria-label={t('admin.sectionsLabel')}>
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {t(label)}
          </a>
        ))}
      </nav>
      <UsersSection users={users.data} meId={me?.id} settings={settings} />
      <InvitesSection settings={settings} />
      {instance.data ? (
        <InstanceSettingsSection server={instance.data} />
      ) : (
        <SettingsCard id="instance" title={t('admin.sectionInstance')}>
          {instance.error ? (
            <LoadError
              message={t('admin.instanceLoadFailed', { message: instance.error.message })}
              onRetry={() => void instance.refetch()}
              className="is-compact"
            />
          ) : (
            <Loading label={t('admin.loadingInstance')} className="is-compact" />
          )}
        </SettingsCard>
      )}
    </div>
  );
}

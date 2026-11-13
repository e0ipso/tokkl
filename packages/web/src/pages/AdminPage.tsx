import { Route, Switch } from 'wouter';
import { useMe } from '../api/account.ts';
import { useAdminUsers, useInstanceSettings } from '../api/admin.ts';
import { useSettings } from '../api/settings.ts';
import { LoadError, Loading } from '../components/PageState.tsx';
import { InstanceSettingsSection } from './admin/InstanceSettingsSection.tsx';
import { InvitesSection } from './admin/InvitesSection.tsx';
import { UsersSection } from './admin/UsersSection.tsx';
import { SettingsCard } from './manage/settings/SettingsCard.tsx';
import { SettingsNav, SettingsRedirect } from './manage/settings/SettingsNav.tsx';
import { t } from '../i18n/messages.ts';

/** The server's 403 on /api/app/admin/* is what protects the page; anyone else who opens /admin sees it. */

const SECTIONS = [
  ['users', 'admin.sectionUsers'],
  ['invites', 'admin.sectionInvites'],
  ['instance', 'admin.sectionInstance'],
] as const;

function InstanceSettingsPage() {
  const instance = useInstanceSettings();
  if (instance.data) return <InstanceSettingsSection server={instance.data} />;
  return (
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
  );
}

export function AdminPage() {
  const { data: me } = useMe();
  const settings = useSettings();
  const users = useAdminUsers();
  // Load child pages only after the users list proves admin access.

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
      <SettingsNav base="/admin" sections={SECTIONS} label={t('admin.sectionsLabel')} />
      <Switch>
        <Route path="/admin/users">
          <UsersSection users={users.data} meId={me?.id} settings={settings} />
        </Route>
        <Route path="/admin/invites">
          <InvitesSection settings={settings} />
        </Route>
        <Route path="/admin/instance" component={InstanceSettingsPage} />
        <Route>
          <SettingsRedirect base="/admin" sections={SECTIONS} />
        </Route>
      </Switch>
    </div>
  );
}

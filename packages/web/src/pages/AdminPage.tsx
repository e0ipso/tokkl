import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.ts';
import { keys, useMe } from '../api/hooks.ts';
import type { AdminAccount, InstanceSettings, Invite, PasswordResetLink, UserRole } from '../api/types.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { useFieldErrors } from '../components/FieldError.tsx';
import { Icon } from '../components/Icon.tsx';
import { LoadError, Loading } from '../components/PageState.tsx';
import { useToast } from '../components/Toast.tsx';
import { copyText } from '../lib/clipboard.ts';
import { localDay } from '../lib/entryTime.ts';
import { formatDate, formatTime, useSettings, type Settings } from '../lib/settings.ts';
import { useAction } from './manage/queries.ts';
import { focusPastRow, keepFocusPastRow, rowAction } from './manage/rowFocus.ts';
import { SettingsCard } from './manage/settings/SettingsCard.tsx';
import { ConfirmModal, StatusBadge } from './manage/ui.tsx';
import './manage/manage.css';

/**
 * Instance administration: accounts, invite links and instance settings. Only admins see the nav
 * entry, but the server's 403 on /api/app/admin/* is what protects the page; anyone else who opens
 * /admin gets that message.
 */

const ADMIN = '/api/app/admin';

const adminKeys = {
  users: ['admin', 'users'] as const,
  invites: ['admin', 'invites'] as const,
  settings: ['admin', 'settings'] as const,
};

const ROLES: ReadonlyArray<{ value: UserRole; label: string }> = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
];

const SECTIONS = [
  ['users', 'Users'],
  ['invites', 'Invites'],
  ['instance', 'Instance settings'],
] as const;

/** Must match MAX_INVITE_NOTE_LENGTH in packages/api/src/domain/accounts.ts. */
const MAX_NOTE_LENGTH = 255;

function day(iso: string, settings: Settings): string {
  return formatDate(localDay(iso, settings.timeZone), settings.dateFormat);
}

function dateTime(iso: string, settings: Settings): string {
  return `${day(iso, settings)} ${formatTime(iso, settings)}`;
}

function roleLabel(role: UserRole): string {
  return role === 'admin' ? 'an admin' : 'a regular user';
}

/** A server path such as /invite/<token> as a full link to share. */
function absoluteLink(path: string): string {
  return new URL(path, window.location.origin).href;
}

function UserRow({ user, self, settings, onDelete, onResetLink }: {
  user: AdminAccount;
  self: boolean;
  settings: Settings;
  onDelete: (user: AdminAccount) => void;
  onResetLink: (user: AdminAccount, link: string) => void;
}) {
  const fields = useFieldErrors<'role' | 'status'>();
  const disabled = user.disabled_at !== null;

  // A refusal, such as the last-admin 400, shows under the control that sent the change.
  const update = useAction<{ role: UserRole } | { disabled: boolean }, AdminAccount>({
    mutationFn: (body) => api.patch<AdminAccount>(`${ADMIN}/users/${user.id}`, body),
    invalidate: [adminKeys.users, keys.me],
    success: (updated, body) => ('role' in body
      ? `${updated.email} is now ${roleLabel(updated.role)}`
      : `${updated.disabled_at ? 'Disabled' : 'Enabled'} ${updated.email}`),
    onError: (error, body) => fields.validate([['role' in body ? 'role' : 'status', error.message]]),
  });
  const revoke = useAction({
    mutationFn: () => api.post(`${ADMIN}/users/${user.id}/sessions/revoke`),
    success: `Signed ${user.email} out of every browser. Their API token still works.`,
  });
  const reset = useAction<void, PasswordResetLink>({
    mutationFn: () => api.post<PasswordResetLink>(`${ADMIN}/users/${user.id}/password-reset`),
    onSuccess: (created) => onResetLink(user, absoluteLink(created.url)),
  });

  // The controls stay enabled while a change is pending, so the one that failed keeps focus and
  // its error can take it; a second change waits for the first.
  const change = (body: { role: UserRole } | { disabled: boolean }) => {
    if (update.isPending) return;
    fields.clear('role' in body ? 'role' : 'status');
    update.mutate(body);
  };

  return (
    <tr className={disabled ? 'archived' : undefined} data-id={user.id}>
      <td className="admin-account">
        <span className="admin-account-name">{user.fullname || user.email}{self ? <span className="muted"> (you)</span> : null}</span>
        {user.fullname ? <span className="admin-account-email">{user.email}</span> : null}
      </td>
      <td>
        <select
          {...fields.field('role')}
          aria-label={`Role of ${user.email}`}
          value={user.role}
                    onChange={(event) => change({ role: event.target.value as UserRole })}
        >
          {ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
        </select>
        {fields.message('role')}
      </td>
      <td>
        <div className="admin-status">
          <StatusBadge archived={disabled} label={disabled ? 'Disabled' : 'Active'} />
          <button
            {...fields.field('status')}
            type="button"
            className="button button-ghost"
            aria-label={`${disabled ? 'Enable' : 'Disable'} ${user.email}`}
                        onClick={() => change({ disabled: !disabled })}
          >
            {disabled ? 'Enable' : 'Disable'}
          </button>
        </div>
        {fields.message('status')}
      </td>
      <td className="num admin-date">{day(user.created_at, settings)}</td>
      {/* Plain buttons rather than a RowMenu, so Tab reaches both actions in row order. */}
      <td className="manage-actions">
        {self ? null : (
          <>
            <button
              type="button"
              className="icon-button"
              aria-label={`Revoke sessions of ${user.email}`}
              title="Revoke sessions: sign out of every browser"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              <Icon name="logout" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Reset password of ${user.email}`}
              data-row-action="reset"
              title="Reset password: create a one-time link to set a new password"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
            >
              <Icon name="key" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Delete ${user.email}`}
              data-row-action="delete"
              title="Delete account"
              onClick={() => onDelete(user)}
            >
              <Icon name="trash" size={16} />
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

function DeleteUserModal({ user, onClose, onDeleted }: { user: AdminAccount; onClose: () => void; onDeleted: () => void }) {
  const fields = useFieldErrors<'email'>();
  const [email, setEmail] = useState('');
  const remove = useAction<string>({
    mutationFn: (typed) => api.delete(`${ADMIN}/users/${user.id}`, { email: typed }),
    invalidate: [adminKeys.users],
    success: `Deleted ${user.email}`,
    onSuccess: onDeleted,
    onError: (error) => fields.validate([['email', error.message]]),
  });

  const confirm = (event?: FormEvent) => {
    event?.preventDefault();
    const typed = email.trim();
    if (!fields.validate([['email', typed.toLowerCase() !== user.email.toLowerCase() && "Type the account's email to confirm"]])) return;
    remove.mutate(typed);
  };

  return (
    <ConfirmModal
      title={`Delete ${user.email}?`}
      confirmLabel="Delete account"
      busy={remove.isPending}
      onConfirm={() => confirm()}
      onClose={onClose}
    >
      <p>This deletes the account and its workspace, with every time entry, project, client and tag in it. It cannot be undone.</p>
      <p>To keep the data, disable the account instead. A disabled account can be enabled again.</p>
      <p>Ask them to export their data first, from Settings, Data.</p>
      <form noValidate onSubmit={confirm}>
        <div className="field">
          <label htmlFor={fields.id('email')}>Type <strong>{user.email}</strong> to confirm</label>
          <input
            {...fields.field('email')}
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {fields.message('email')}
        </div>
      </form>
    </ConfirmModal>
  );
}

function UsersSection({ users, meId, settings }: { users: AdminAccount[]; meId: number | undefined; settings: Settings }) {
  const [deleting, setDeleting] = useState<AdminAccount | null>(null);
  const [reset, setReset] = useState<{ id: number; email: string; link: string } | null>(null);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  return (
    <SettingsCard
      id="users"
      title="Users"
      titleRef={title}
      intro="Every account on this server. Disabling signs the account out and blocks it until you enable it again."
    >
      <div className="table-wrap">
        <table className="table admin-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Role</th>
              <th>Status</th>
              <th className="num">Created</th>
              <th><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody ref={tbody}>
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                self={user.id === meId}
                settings={settings}
                onDelete={setDeleting}
                onResetLink={(account, link) => setReset({ id: account.id, email: account.email, link })}
              />
            ))}
          </tbody>
        </table>
      </div>
      {reset ? (
        <NewLink
          key={reset.link}
          link={reset.link}
          label={`Password reset link for ${reset.email}`}
          copied="Reset link copied"
          onDone={() => {
            (rowAction(tbody.current, reset.id, 'reset') ?? title.current)?.focus();
            setReset(null);
          }}
        >
          <strong>Password reset link for {reset.email} created.</strong> Copy it now: it is shown only once. Send it to
          them; it works once, for 24 hours, and replaces any earlier link. Using it signs the account out of every
          browser and replaces their API token, so apps signed in with the old one must sign in again.
        </NewLink>
      ) : null}
      {deleting ? (
        <DeleteUserModal
          key={deleting.id}
          user={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            // The modal had focus; the row that opened it goes away once the list refetches.
            focusPastRow(tbody.current, deleting.id, 'delete', title.current);
            setDeleting(null);
          }}
        />
      ) : null}
    </SettingsCard>
  );
}

/**
 * A new one-time link, such as an invite or a password reset link. The server returns it only once,
 * so it is gone after a reload.
 */
function NewLink({ link, label, copied, onDone, children }: {
  link: string;
  label: string;
  copied: string;
  onDone: () => void;
  children: ReactNode;
}) {
  const toast = useToast();
  const copy = () => {
    copyText(link, 'Could not copy. Select the link and copy it by hand.')
      .then(() => toast.show(copied), (error: unknown) => toast.error(error));
  };
  return (
    <div className="settings-notice admin-new-link" role="status">
      <div className="admin-new-link-text">
        <p>{children}</p>
        <code className="token-value" aria-label={label}>{link}</code>
      </div>
      <div className="inline-controls">
        <button type="button" className="button button-ghost" onClick={copy}>
          <Icon name="copy" size={16} /> Copy link
        </button>
        <button type="button" className="button button-ghost" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

function InviteRow({ invite, settings, onRevoked }: { invite: Invite; settings: Settings; onRevoked: () => void }) {
  const revoke = useAction({
    mutationFn: () => api.delete(`${ADMIN}/invites/${invite.id}`),
    invalidate: [adminKeys.invites],
    success: 'Invite revoked. Its link no longer works.',
    onSuccess: onRevoked,
  });
  const name = invite.note ? `invite "${invite.note}"` : `${invite.role} invite`;
  return (
    <tr data-id={invite.id}>
      <td>{invite.role === 'admin' ? 'Admin' : 'User'}</td>
      <td className="manage-notes" title={invite.note ?? undefined}>{invite.note ?? <span className="muted">None</span>}</td>
      <td className="num admin-date">{day(invite.created_at, settings)}</td>
      <td className="num admin-date">{dateTime(invite.expires_at, settings)}</td>
      <td className="manage-actions">
        <button
          type="button"
          className="button button-danger-ghost"
          aria-label={`Revoke ${name}`}
          data-row-action="revoke"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate()}
        >
          Revoke
        </button>
      </td>
    </tr>
  );
}

function InvitesSection({ settings }: { settings: Settings }) {
  const invites = useQuery({ queryKey: adminKeys.invites, queryFn: () => api.get<Invite[]>(`${ADMIN}/invites`) });
  const fields = useFieldErrors<'role' | 'note'>();
  const [role, setRole] = useState<UserRole>('user');
  const [note, setNote] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);

  const revoked = (id: number) => keepFocusPastRow(tbody.current, id, 'revoke', heading.current);

  const create = useAction<{ role: UserRole; note: string }, Invite & { url: string }>({
    mutationFn: (body) => api.post<Invite & { url: string }>(`${ADMIN}/invites`, body),
    invalidate: [adminKeys.invites],
    onSuccess: (invite) => {
      setLink(absoluteLink(invite.url));
      setNote('');
    },
    onError: (error) => fields.validate([[/role/i.test(error.message) ? 'role' : 'note', error.message]]),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLink(null);
    create.mutate({ role, note: note.trim() });
  };

  return (
    <SettingsCard
      id="invites"
      title="Invites"
      intro="An invite link lets one person create an account. The server sends no email; share the link yourself."
    >
      <form className="form-grid admin-invite-form" aria-label="New invite" noValidate onSubmit={submit}>
        <div className="field">
          <label htmlFor={fields.id('role')}>Role</label>
          <select {...fields.field('role')} value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
            {ROLES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {fields.message('role')}
        </div>
        <div className="field">
          <label htmlFor={fields.id('note')}>Note (optional)</label>
          <input
            {...fields.field('note')}
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            placeholder="Who it is for"
            onChange={(event) => setNote(event.target.value)}
          />
          {fields.message('note')}
        </div>
        <div className="settings-actions field-full">
          <button ref={createButton} type="submit" className="button button-primary" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create invite'}
          </button>
        </div>
      </form>
      {link ? (
        <NewLink
          link={link}
          label="Invite link"
          copied="Invite link copied"
          onDone={() => {
            createButton.current?.focus();
            setLink(null);
          }}
        >
          <strong>Invite link created.</strong> Copy it now: it is shown only once. Send it to the person you invite.
        </NewLink>
      ) : null}

      <h3 ref={heading} className="settings-subheading" tabIndex={-1}>Pending invites</h3>
      {invites.error ? (
        <LoadError message={`Could not load invites: ${invites.error.message}`} onRetry={() => void invites.refetch()} className="is-compact" />
      ) : null}
      {invites.isLoading ? <Loading label="Loading invites…" className="is-compact" /> : null}
      {invites.data && invites.data.length === 0 ? (
        <EmptyState compact title="No pending invites">Links that were used, revoked or expired drop off this list.</EmptyState>
      ) : null}
      {invites.data && invites.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table admin-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Note</th>
                <th className="num">Created</th>
                <th className="num">Expires</th>
                <th><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody ref={tbody}>
              {invites.data.map((invite) => (
                <InviteRow key={invite.id} invite={invite} settings={settings} onRevoked={() => revoked(invite.id)} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </SettingsCard>
  );
}

const SETTING_FIELDS = [
  { key: 'session_days', unit: 'days', label: 'Session length (days)', hint: 'New logins stay signed in this long. Existing sessions keep their expiry.' },
  { key: 'invite_days', unit: 'days', label: 'Invite link lifetime (days)', hint: 'New invite links stop working after this many days.' },
  {
    key: 'time_resolution_minutes',
    unit: 'minutes',
    label: 'Time resolution (minutes)',
    hint: 'Starts and stops move to the nearest multiple of this many minutes. A timer that rounds to zero goes to the trash, and a typed entry that rounds to zero is refused. Existing entries change only when they are edited.',
  },
] as const satisfies ReadonlyArray<{ key: keyof InstanceSettings; unit: string; label: string; hint: string }>;

type SettingsDraft = Record<keyof InstanceSettings, string>;

/**
 * The form keeps only what the admin typed and has not saved. A field changed back to the server's
 * value is no longer an edit, except while a save is pending: the server's value may be about to
 * change, so everything typed then stays an edit until the save settles. Every other field shows the
 * server's value, so a background refetch, such as after another admin's change, updates the
 * untouched fields and leaves the edits and focus alone. Saving sends only the edited fields, so it
 * never writes back a value the admin did not change.
 */
function InstanceSettingsSection({ server }: { server: InstanceSettings }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fields = useFieldErrors<keyof InstanceSettings>();
  const [edits, setEdits] = useState<Partial<SettingsDraft>>({});
  const draft: SettingsDraft = {
    session_days: edits.session_days ?? String(server.session_days),
    invite_days: edits.invite_days ?? String(server.invite_days),
    time_resolution_minutes: edits.time_resolution_minutes ?? String(server.time_resolution_minutes),
  };

  // Once a save settles, an edit equal to the server's value is no longer an edit. Anything else
  // typed while the request ran stays, even a value equal to what the server had before the save.
  const dropEditsEqualTo = (values: InstanceSettings) => setEdits((current) => Object.fromEntries(
    Object.entries(current).filter(([key, value]) => Number(value.trim()) !== values[key as keyof InstanceSettings]),
  ));

  const save = useAction<Partial<InstanceSettings>, InstanceSettings>({
    mutationFn: (body) => api.put<InstanceSettings>(`${ADMIN}/settings`, body),
    invalidate: [adminKeys.settings],
    success: 'Instance settings saved',
    onSuccess: (saved) => {
      queryClient.setQueryData(adminKeys.settings, saved);
      dropEditsEqualTo(saved);
    },
    onError: (error) => {
      const current = queryClient.getQueryData<InstanceSettings>(adminKeys.settings);
      if (current) dropEditsEqualTo(current);
      // The server names the setting it refused, as in "Invalid invite_days: ...".
      const field = SETTING_FIELDS.find(({ key }) => error.message.includes(key));
      if (field) fields.validate([[field.key, error.message]]);
      else toast.error(error);
    },
  });

  // Only whole numbers go to the server; it checks the allowed values and its 400 shows on the field.
  const submit = () => {
    const valid = fields.validate(SETTING_FIELDS.map(({ key, unit }) => [
      key,
      (draft[key].trim() === '' || !Number.isInteger(Number(draft[key].trim()))) && `Enter a whole number of ${unit}`,
    ] as const));
    if (!valid) return;
    const changes: Partial<InstanceSettings> = {};
    for (const { key } of SETTING_FIELDS) {
      const value = edits[key];
      if (value !== undefined) changes[key] = Number(value.trim());
    }
    if (Object.keys(changes).length > 0) save.mutate(changes);
    else toast.show('No changes to save');
  };

  // A value equal to the server's is not an edit, so later refetches show the server's value again.
  // While a save is pending the server's value may still change, so every typed value stays.
  const edit = (key: keyof InstanceSettings, value: string) => setEdits((current) => {
    const next = { ...current };
    if (!save.isPending && value === String(server[key])) delete next[key];
    else next[key] = value;
    return next;
  });

  return (
    <SettingsCard id="instance" title="Instance settings" onSubmit={submit} saving={save.isPending}>
      <div className="form-grid">
        {SETTING_FIELDS.map(({ key, label, hint }) => (
          <div key={key} className="field">
            <label htmlFor={fields.id(key)}>{label}</label>
            <input
              {...fields.field(key)}
              type="number"
              inputMode="numeric"
              value={draft[key]}
              onChange={(event) => edit(key, event.target.value)}
            />
            {fields.message(key)}
            <p className="hint">{hint}</p>
          </div>
        ))}
      </div>
    </SettingsCard>
  );
}

export function AdminPage() {
  const { data: me } = useMe();
  const settings = useSettings();
  const users = useQuery({ queryKey: adminKeys.users, queryFn: () => api.get<AdminAccount[]>(`${ADMIN}/users`) });
  // Wait for the users list, so a non-admin sends one refused request, not three.
  const instance = useQuery({
    queryKey: adminKeys.settings,
    queryFn: () => api.get<InstanceSettings>(`${ADMIN}/settings`),
    enabled: users.isSuccess,
  });

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
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </nav>
      <UsersSection users={users.data} meId={me?.id} settings={settings} />
      <InvitesSection settings={settings} />
      {instance.data ? <InstanceSettingsSection server={instance.data} /> : (
        <SettingsCard id="instance" title="Instance settings">
          {instance.error ? (
            <LoadError message={`Could not load instance settings: ${instance.error.message}`} onRetry={() => void instance.refetch()} className="is-compact" />
          ) : <Loading label="Loading instance settings…" className="is-compact" />}
        </SettingsCard>
      )}
    </div>
  );
}

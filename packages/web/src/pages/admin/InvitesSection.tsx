import { useRef, useState, type FormEvent } from 'react';
import { adminRequests, useAdminInvites } from '../../api/admin.ts';
import { stale } from '../../api/keys.ts';
import type { CreatedInvite, Invite, UserRole } from '@tokkl/types';
import { EmptyState } from '../../components/EmptyState.tsx';
import { useFieldErrors } from '../../components/FieldError.tsx';
import { LoadError, Loading } from '../../components/PageState.tsx';
import { useAction } from '../../components/useAction.ts';
import { formatDateTime, formatDay } from '../../lib/format.ts';
import type { Settings } from '../../lib/settings.ts';
import { keepFocusPastRow } from '../manage/rowFocus.ts';
import { SettingsCard } from '../manage/settings/SettingsCard.tsx';
import { NewLink } from './NewLink.tsx';
import { ROLES, absoluteLink, isUserRole } from './roles.ts';
import { t } from '../../i18n/messages.ts';

/** Must match MAX_INVITE_NOTE_LENGTH in packages/api/src/domain/accounts.ts. */
const MAX_NOTE_LENGTH = 255;

function InviteRow({ invite, settings, onRevoked }: { invite: Invite; settings: Settings; onRevoked: () => void }) {
  const signup = invite.source === 'signup';
  const detail = signup ? invite.email : invite.note;
  const revoke = useAction({
    mutationFn: () => adminRequests.revokeInvite(invite.id),
    invalidate: stale.adminInvites,
    success: t('admin.inviteRevoked'),
    onSuccess: onRevoked,
  });
  const revokeLabel =
    signup && invite.email
      ? t('admin.revokeSignupInvite', { email: invite.email })
      : invite.note
        ? t('admin.revokeNoteInvite', { note: invite.note })
        : t(invite.role === 'admin' ? 'admin.revokeAdminInvite' : 'admin.revokeUserInvite');
  return (
    <tr data-id={invite.id}>
      <td>{signup ? t('admin.signupInvite') : t(invite.role === 'admin' ? 'admin.roleAdmin' : 'admin.roleUser')}</td>
      <td className="manage-notes" title={detail ?? undefined}>
        {detail ?? <span className="muted">{t('admin.none')}</span>}
      </td>
      <td className="num admin-date">{formatDay(invite.created_at, settings)}</td>
      <td className="num admin-date">{formatDateTime(invite.expires_at, settings)}</td>
      <td className="manage-actions">
        <button
          type="button"
          className="button button-danger-ghost"
          aria-label={revokeLabel}
          data-row-action="revoke"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate()}
        >
          {t('admin.revoke')}
        </button>
      </td>
    </tr>
  );
}

export function InvitesSection({ settings }: { settings: Settings }) {
  const invites = useAdminInvites();
  const fields = useFieldErrors<'role' | 'note'>();
  const [role, setRole] = useState<UserRole>('user');
  const [note, setNote] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);

  const revoked = (id: number) => keepFocusPastRow(tbody.current, id, 'revoke', heading.current);

  const create = useAction<{ role: UserRole; note: string }, CreatedInvite>({
    mutationFn: adminRequests.createInvite,
    invalidate: stale.adminInvites,
    onSuccess: invite => {
      setLink(absoluteLink(invite.url));
      setNote('');
    },
    onError: error => fields.validate([[/role/i.test(error.message) ? 'role' : 'note', error.message]]),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLink(null);
    create.mutate({ role, note: note.trim() });
  };

  return (
    <SettingsCard id="invites" title={t('admin.sectionInvites')} intro={t('admin.invitesIntro')}>
      <form className="form-grid admin-invite-form" aria-label={t('admin.newInvite')} noValidate onSubmit={submit}>
        <div className="field">
          <label htmlFor={fields.id('role')}>{t('admin.role')}</label>
          <select
            {...fields.field('role')}
            value={role}
            onChange={event => {
              const next = event.target.value;
              if (isUserRole(next)) setRole(next);
            }}
          >
            {ROLES.map(option => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
          {fields.message('role')}
        </div>
        <div className="field">
          <label htmlFor={fields.id('note')}>{t('admin.noteOptional')}</label>
          <input
            {...fields.field('note')}
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            placeholder={t('admin.notePlaceholder')}
            onChange={event => setNote(event.target.value)}
          />
          {fields.message('note')}
        </div>
        <div className="settings-actions field-full">
          <button ref={createButton} type="submit" className="button button-primary" disabled={create.isPending}>
            {create.isPending ? t('admin.creating') : t('admin.createInvite')}
          </button>
        </div>
      </form>
      {link ? (
        <NewLink
          link={link}
          label={t('admin.inviteLink')}
          copied={t('admin.inviteLinkCopied')}
          onDone={() => {
            createButton.current?.focus();
            setLink(null);
          }}
        >
          <strong>{t('admin.inviteLinkCreated')}</strong> {t('admin.inviteLinkHelp')}
        </NewLink>
      ) : null}

      <h3 ref={heading} className="settings-subheading" tabIndex={-1}>
        {t('admin.pendingInvites')}
      </h3>
      {invites.error ? (
        <LoadError
          message={t('admin.invitesLoadFailed', { message: invites.error.message })}
          onRetry={() => void invites.refetch()}
          className="is-compact"
        />
      ) : null}
      {invites.isLoading ? <Loading label={t('admin.loadingInvites')} className="is-compact" /> : null}
      {invites.data && invites.data.length === 0 ? (
        <EmptyState compact title={t('admin.noPendingInvites')}>
          {t('admin.noPendingInvitesBody')}
        </EmptyState>
      ) : null}
      {invites.data && invites.data.length > 0 ? (
        <div className="table-wrap">
          <table className="table admin-table">
            <thead>
              <tr>
                <th>{t('admin.role')}</th>
                <th>{t('admin.noteOrEmail')}</th>
                <th className="num">{t('admin.created')}</th>
                <th className="num">{t('admin.expires')}</th>
                <th>
                  <span className="visually-hidden">{t('admin.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody ref={tbody}>
              {invites.data.map(invite => (
                <InviteRow key={invite.id} invite={invite} settings={settings} onRevoked={() => revoked(invite.id)} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </SettingsCard>
  );
}

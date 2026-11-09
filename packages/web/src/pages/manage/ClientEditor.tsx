import { useId, useState, type FormEvent } from 'react';
import { useWid } from '../../api/account.ts';
import { clientRequests, type ClientBody } from '../../api/clients.ts';
import { stale } from '../../api/keys.ts';
import type { Client } from '@tokkl/types';
import { useFieldErrors } from '../../components/FieldError.tsx';
import { Modal } from '../../components/Overlay.tsx';
import { useAction } from '../../components/useAction.ts';
import { t } from '../../i18n/messages.ts';

/** Creates a client, or edits one: its name and notes. */
export function ClientEditor({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const wid = useWid();
  const formId = useId();
  const fields = useFieldErrors<'name'>();
  const [name, setName] = useState(client?.name ?? '');
  const [notes, setNotes] = useState(client?.notes ?? '');

  const save = useAction<ClientBody, Client>({
    mutationFn: body => (client ? clientRequests.update(wid, client.id, body) : clientRequests.create(wid, body)),
    invalidate: stale.clients,
    movesTimer: true,
    success: saved => (client ? t('manage.saved', { name: saved.name }) : t('manage.created', { name: saved.name })),
    onSuccess: onClose,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!fields.validate([['name', !name.trim() && t('manage.enterClientName')]])) return;
    save.mutate({ name: name.trim(), notes: notes.trim() || null });
  };

  return (
    <Modal
      title={client ? t('manage.editClient') : t('manage.newClient')}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="button button-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form={formId} className="button button-primary" disabled={save.isPending}>
            {client ? t('common.save') : t('manage.createClient')}
          </button>
        </>
      }
    >
      <form id={formId} className="form-grid" noValidate onSubmit={submit}>
        <div className="field field-full">
          <label htmlFor={fields.id('name')}>{t('manage.name')}</label>
          <input
            {...fields.field('name')}
            value={name}
            maxLength={255}
            required
            onChange={event => setName(event.target.value)}
          />
          {fields.message('name')}
        </div>
        <label className="field field-full">
          <span>{t('manage.notes')}</span>
          <textarea rows={4} value={notes} maxLength={10_000} onChange={event => setNotes(event.target.value)} />
        </label>
      </form>
    </Modal>
  );
}

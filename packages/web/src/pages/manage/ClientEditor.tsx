import { useId, useState, type FormEvent } from 'react';
import { useWid } from '../../api/account.ts';
import { clientRequests, type ClientBody } from '../../api/clients.ts';
import { stale } from '../../api/keys.ts';
import type { Client } from '../../api/types.ts';
import { useFieldErrors } from '../../components/FieldError.tsx';
import { Modal } from '../../components/Overlay.tsx';
import { useAction } from '../../components/useAction.ts';

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
    success: saved => (client ? `Saved ${saved.name}` : `Created ${saved.name}`),
    onSuccess: onClose,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!fields.validate([['name', !name.trim() && 'Enter a client name']])) return;
    save.mutate({ name: name.trim(), notes: notes.trim() || null });
  };

  return (
    <Modal
      title={client ? 'Edit client' : 'New client'}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="button button-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="button button-primary" disabled={save.isPending}>
            {client ? 'Save' : 'Create client'}
          </button>
        </>
      }
    >
      <form id={formId} className="form-grid" noValidate onSubmit={submit}>
        <div className="field field-full">
          <label htmlFor={fields.id('name')}>Name</label>
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
          <span>Notes</span>
          <textarea rows={4} value={notes} maxLength={10_000} onChange={event => setNotes(event.target.value)} />
        </label>
      </form>
    </Modal>
  );
}

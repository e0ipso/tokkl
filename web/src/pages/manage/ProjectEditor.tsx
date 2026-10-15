import { useId, useState, type FormEvent } from 'react';
import { api } from '../../api/client.ts';
import { keys, useClients, useProjects, useWid, useWorkspace } from '../../api/hooks.ts';
import type { Client, Project } from '../../api/types.ts';
import { useFieldErrors } from '../../components/FieldError.tsx';
import { Modal } from '../../components/Overlay.tsx';
import { PROJECT_COLORS } from '@timetrack/common/colors';
import { ColorField } from './ColorField.tsx';
import { ProjectTasks } from './ProjectTasks.tsx';
import { parseOptionalAmount, useAction, wsPath } from './queries.ts';

const NEW_CLIENT = '__new__';

interface ProjectBody {
  name: string;
  color: string;
  /** 0 clears the client. The server ignores null here and keeps the current client. */
  client_id: number;
  billable: boolean;
  rate: number | null;
  currency: string | null;
  estimated_hours: number | null;
}

function amountText(value: number | null): string {
  return value === null ? '' : String(value);
}

/** Create or edit a project. Editing an existing project also shows its tasks. */
export function ProjectEditor({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const wid = useWid();
  const formId = useId();
  const fields = useFieldErrors<'name' | 'client' | 'rate' | 'currency' | 'estimate'>();
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();
  const { data: workspace } = useWorkspace();

  const [name, setName] = useState(project?.name ?? '');
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[projects.length % PROJECT_COLORS.length]!);
  const [clientId, setClientId] = useState<number | null>(project?.client_id ?? null);
  const [creatingClient, setCreatingClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [billable, setBillable] = useState(project?.billable ?? false);
  const [rate, setRate] = useState(amountText(project?.rate ?? null));
  const [currency, setCurrency] = useState(project?.currency ?? '');
  const [estimate, setEstimate] = useState(amountText(project?.estimated_hours ?? null));

  const save = useAction<ProjectBody, Project>({
    mutationFn: (body) => (project
      ? api.put<Project>(wsPath(wid, 'projects', project.id), body)
      : api.post<Project>(wsPath(wid, 'projects'), body)),
    invalidate: [keys.projects, keys.clients, keys.tasks, keys.entries, keys.current, keys.report],
    success: (saved) => (project ? `Saved ${saved.name}` : `Created ${saved.name}`),
    onSuccess: onClose,
  });

  const createClient = useAction<string, Client>({
    mutationFn: (clientName) => api.post<Client>(wsPath(wid, 'clients'), { name: clientName }),
    invalidate: [keys.clients],
    success: (client) => `Created client ${client.name}`,
    onSuccess: (client) => {
      setClientId(client.id);
      setCreatingClient(false);
      setNewClientName('');
    },
  });

  // Archived clients only show up when the project already uses one.
  const clientOptions = clients.filter((client) => !client.archived || client.id === clientId);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsedRate = parseOptionalAmount(rate);
    const parsedEstimate = parseOptionalAmount(estimate);
    const code = currency.trim().toUpperCase();
    // Checked in the order the fields appear, so focus goes to the first one to fix.
    const valid = fields.validate([
      ['name', !name.trim() && 'Enter a project name'],
      ['rate', parsedRate === undefined && 'Hourly rate must be a number of 0 or more'],
      ['currency', code !== '' && !/^[A-Z]{3}$/.test(code) && 'Currency must be a 3-letter code, like EUR'],
      ['estimate', parsedEstimate === undefined && 'Estimated hours must be a number of 0 or more'],
    ]);
    if (!valid || parsedRate === undefined || parsedEstimate === undefined) return;
    save.mutate({
      name: name.trim(),
      color,
      client_id: clientId ?? 0,
      billable,
      rate: parsedRate,
      currency: code || null,
      estimated_hours: parsedEstimate,
    });
  };

  const submitNewClient = () => {
    const trimmed = newClientName.trim();
    if (!fields.validate([['client', !trimmed && 'Enter a client name']])) return;
    createClient.mutate(trimmed);
  };

  return (
    <Modal
      title={project ? 'Edit project' : 'New project'}
      onClose={onClose}
      wide={project !== null}
      footer={(
        <>
          <span className="spacer" />
          <button type="button" className="button button-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form={formId} className="button button-primary" disabled={save.isPending}>
            {project ? 'Save' : 'Create project'}
          </button>
        </>
      )}
    >
      <form id={formId} className="form-grid" noValidate onSubmit={submit}>
        <div className="field field-full">
          <label htmlFor={fields.id('name')}>Name</label>
          <input {...fields.field('name')} value={name} onChange={(event) => setName(event.target.value)} maxLength={255} required />
          {fields.message('name')}
        </div>

        <div className="field field-full">
          <span>Color</span>
          <ColorField value={color} onChange={setColor} />
        </div>

        <div className="field field-full">
          <label className="field">
            <span>Client</span>
            <select
              value={creatingClient ? NEW_CLIENT : String(clientId ?? '')}
              onChange={(event) => {
                const value = event.target.value;
                setCreatingClient(value === NEW_CLIENT);
                if (value !== NEW_CLIENT) setClientId(value === '' ? null : Number(value));
              }}
            >
              <option value="">No client</option>
              {clientOptions.map((client) => (
                <option key={client.id} value={client.id}>{client.name}{client.archived ? ' (archived)' : ''}</option>
              ))}
              <option value={NEW_CLIENT}>Create client…</option>
            </select>
          </label>
          {creatingClient ? (
            <div className="inline-controls manage-inline-create">
              <input
                {...fields.field('client')}
                value={newClientName}
                placeholder="New client name"
                aria-label="New client name"
                maxLength={255}
                autoFocus
                onChange={(event) => setNewClientName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitNewClient();
                  }
                }}
              />
              <button type="button" className="button" disabled={createClient.isPending} onClick={submitNewClient}>Add client</button>
              <button
                type="button"
                className="button button-ghost"
                onClick={() => {
                  setCreatingClient(false);
                  fields.clear('client');
                }}
              >
                Cancel
              </button>
            </div>
          ) : null}
          {creatingClient ? fields.message('client') : null}
        </div>

        <div className="field">
          <label htmlFor={fields.id('rate')}>Hourly rate</label>
          <input
            {...fields.field('rate')}
            inputMode="decimal"
            value={rate}
            placeholder={workspace?.default_hourly_rate != null ? `Workspace rate: ${workspace.default_hourly_rate}` : 'No rate'}
            onChange={(event) => setRate(event.target.value)}
          />
          {fields.message('rate')}
        </div>
        <div className="field">
          <label htmlFor={fields.id('currency')}>Currency</label>
          <input
            {...fields.field('currency')}
            value={currency}
            maxLength={3}
            placeholder={workspace?.default_currency ?? 'EUR'}
            autoCapitalize="characters"
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
          {fields.message('currency')}
        </div>
        <div className="field">
          <label htmlFor={fields.id('estimate')}>Estimated hours</label>
          <input {...fields.field('estimate')} inputMode="decimal" value={estimate} placeholder="No estimate" onChange={(event) => setEstimate(event.target.value)} />
          {fields.message('estimate')}
        </div>
        <label className="field checkbox-field">
          <input type="checkbox" checked={billable} onChange={(event) => setBillable(event.target.checked)} />
          <span>Billable by default</span>
        </label>
        <p className="hint field-full">Leave the rate or currency empty to use the workspace defaults.</p>
      </form>

      {project ? <ProjectTasks project={project} /> : null}
    </Modal>
  );
}

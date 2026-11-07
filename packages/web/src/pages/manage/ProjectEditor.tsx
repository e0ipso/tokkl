import { useId, useState, type FormEvent } from 'react';
import { useWid, useWorkspace } from '../../api/account.ts';
import { clientRequests, useClients } from '../../api/clients.ts';
import { stale } from '../../api/keys.ts';
import { projectRequests, useProjects, type ProjectBody } from '../../api/projects.ts';
import type { Client, Project } from '../../api/types.ts';
import { useFieldErrors } from '../../components/FieldError.tsx';
import { Modal } from '../../components/Overlay.tsx';
import { PROJECT_COLORS } from '@tokkl/common/colors';
import { ColorField } from './ColorField.tsx';
import { ProjectTasks } from './ProjectTasks.tsx';
import { useAction } from '../../components/useAction.ts';
import { parseOptionalAmount } from './values.ts';
import { t } from '../../i18n/messages.ts';

const NEW_CLIENT = '__new__';

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
    mutationFn: body => (project ? projectRequests.update(wid, project.id, body) : projectRequests.create(wid, body)),
    invalidate: stale.projectSaved,
    success: saved => (project ? t('manage.saved', { name: saved.name }) : t('manage.created', { name: saved.name })),
    onSuccess: onClose,
  });

  const createClient = useAction<string, Client>({
    mutationFn: clientName => clientRequests.create(wid, { name: clientName }),
    invalidate: stale.clientCreated,
    success: client => t('manage.createdClient', { name: client.name }),
    onSuccess: client => {
      setClientId(client.id);
      setCreatingClient(false);
      setNewClientName('');
    },
  });

  // Archived clients only show up when the project already uses one.
  const clientOptions = clients.filter(client => !client.archived || client.id === clientId);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsedRate = parseOptionalAmount(rate);
    const parsedEstimate = parseOptionalAmount(estimate);
    const code = currency.trim().toUpperCase();
    // Checked in the order the fields appear, so focus goes to the first one to fix.
    const valid = fields.validate([
      ['name', !name.trim() && t('manage.enterProjectName')],
      ['rate', parsedRate === undefined && t('manage.rateInvalid')],
      ['currency', code !== '' && !/^[A-Z]{3}$/.test(code) && t('manage.currencyInvalid')],
      ['estimate', parsedEstimate === undefined && t('manage.estimateInvalid')],
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
    if (!fields.validate([['client', !trimmed && t('manage.enterClientName')]])) return;
    createClient.mutate(trimmed);
  };

  return (
    <Modal
      title={project ? t('manage.editProject') : t('manage.newProject')}
      onClose={onClose}
      wide={project !== null}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="button button-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form={formId} className="button button-primary" disabled={save.isPending}>
            {project ? t('common.save') : t('manage.createProject')}
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
            onChange={event => setName(event.target.value)}
            maxLength={255}
            required
          />
          {fields.message('name')}
        </div>

        <div className="field field-full">
          <span>{t('manage.color')}</span>
          <ColorField value={color} onChange={setColor} />
        </div>

        <div className="field field-full">
          <label className="field">
            <span>{t('manage.client')}</span>
            <select
              value={creatingClient ? NEW_CLIENT : String(clientId ?? '')}
              onChange={event => {
                const value = event.target.value;
                setCreatingClient(value === NEW_CLIENT);
                if (value !== NEW_CLIENT) setClientId(value === '' ? null : Number(value));
              }}
            >
              <option value="">{t('manage.noClient')}</option>
              {clientOptions.map(client => (
                <option key={client.id} value={client.id}>
                  {client.archived ? t('manage.archivedClient', { name: client.name }) : client.name}
                </option>
              ))}
              <option value={NEW_CLIENT}>{t('manage.createClientOption')}</option>
            </select>
          </label>
          {creatingClient ? (
            <div className="inline-controls manage-inline-create">
              <input
                {...fields.field('client')}
                value={newClientName}
                placeholder={t('manage.newClientName')}
                aria-label={t('manage.newClientName')}
                maxLength={255}
                autoFocus
                onChange={event => setNewClientName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitNewClient();
                  }
                }}
              />
              <button type="button" className="button" disabled={createClient.isPending} onClick={submitNewClient}>
                {t('manage.addClient')}
              </button>
              <button
                type="button"
                className="button button-ghost"
                onClick={() => {
                  setCreatingClient(false);
                  fields.clear('client');
                }}
              >
                {t('common.cancel')}
              </button>
            </div>
          ) : null}
          {creatingClient ? fields.message('client') : null}
        </div>

        <div className="field">
          <label htmlFor={fields.id('rate')}>{t('manage.hourlyRate')}</label>
          <input
            {...fields.field('rate')}
            inputMode="decimal"
            value={rate}
            placeholder={
              workspace?.default_hourly_rate != null
                ? t('manage.workspaceRate', { rate: workspace.default_hourly_rate })
                : t('manage.noRate')
            }
            onChange={event => setRate(event.target.value)}
          />
          {fields.message('rate')}
        </div>
        <div className="field">
          <label htmlFor={fields.id('currency')}>{t('manage.currency')}</label>
          <input
            {...fields.field('currency')}
            value={currency}
            maxLength={3}
            placeholder={workspace?.default_currency ?? 'EUR'}
            autoCapitalize="characters"
            onChange={event => setCurrency(event.target.value.toUpperCase())}
          />
          {fields.message('currency')}
        </div>
        <div className="field">
          <label htmlFor={fields.id('estimate')}>{t('manage.estimatedHours')}</label>
          <input
            {...fields.field('estimate')}
            inputMode="decimal"
            value={estimate}
            placeholder={t('manage.noEstimate')}
            onChange={event => setEstimate(event.target.value)}
          />
          {fields.message('estimate')}
        </div>
        <label className="field checkbox-field">
          <input type="checkbox" checked={billable} onChange={event => setBillable(event.target.checked)} />
          <span>{t('manage.billableByDefault')}</span>
        </label>
        <p className="hint field-full">{t('manage.defaultsHint')}</p>
      </form>

      {project ? <ProjectTasks project={project} /> : null}
    </Modal>
  );
}

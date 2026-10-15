import { useState } from 'react';
import { api } from '../../../api/client.ts';
import { keys, useWid } from '../../../api/hooks.ts';
import type { Workspace } from '../../../api/types.ts';
import { useFieldErrors } from '../../../components/FieldError.tsx';
import { parseOptionalAmount, useAction, wsPath } from '../queries.ts';
import { SettingsCard } from './SettingsCard.tsx';

/** The rounding steps Toggl accepts, in minutes. */
const ROUNDING_MINUTES = [0, 1, 5, 6, 10, 12, 15, 30, 60, 240] as const;

const ROUNDING_MODES = [
  { value: 0, label: 'To the nearest step' },
  { value: 1, label: 'Up' },
  { value: -1, label: 'Down' },
] as const;

type WorkspaceBody = Pick<Workspace, 'name' | 'default_currency' | 'default_hourly_rate' | 'rounding' | 'rounding_minutes'>;

function stepLabel(minutes: number): string {
  if (minutes === 0) return "Don't round";
  if (minutes === 60) return '1 hour';
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export function WorkspaceSection({ workspace }: { workspace: Workspace }) {
  const wid = useWid();
  const fields = useFieldErrors<'name' | 'currency' | 'rate'>();
  const [name, setName] = useState(workspace.name);
  const [currency, setCurrency] = useState(workspace.default_currency);
  const [rate, setRate] = useState(workspace.default_hourly_rate === null ? '' : String(workspace.default_hourly_rate));
  const [rounding, setRounding] = useState(workspace.rounding);
  const [roundingMinutes, setRoundingMinutes] = useState(workspace.rounding_minutes);

  const save = useAction<WorkspaceBody, Workspace>({
    mutationFn: (body) => api.put<Workspace>(wsPath(wid), body),
    invalidate: [keys.workspace, keys.report, keys.projects],
    success: 'Workspace saved',
  });

  const submit = () => {
    const code = currency.trim().toUpperCase();
    const parsedRate = parseOptionalAmount(rate);
    const valid = fields.validate([
      ['name', !name.trim() && 'Enter a workspace name'],
      ['currency', !/^[A-Z]{3}$/.test(code) && 'Currency must be a 3-letter code, like EUR'],
      ['rate', parsedRate === undefined && 'Hourly rate must be a number of 0 or more'],
    ]);
    if (!valid || parsedRate === undefined) return;
    save.mutate({
      name: name.trim(),
      default_currency: code,
      default_hourly_rate: parsedRate,
      rounding,
      rounding_minutes: roundingMinutes,
    });
  };

  const steps: number[] = ROUNDING_MINUTES.includes(roundingMinutes as typeof ROUNDING_MINUTES[number])
    ? [...ROUNDING_MINUTES]
    : [...ROUNDING_MINUTES, roundingMinutes].sort((a, b) => a - b);

  return (
    <SettingsCard id="workspace" title="Workspace" onSubmit={submit} saving={save.isPending}>
      <div className="form-grid">
        <div className="field field-full">
          <label htmlFor={fields.id('name')}>Name</label>
          <input {...fields.field('name')} value={name} maxLength={140} onChange={(event) => setName(event.target.value)} />
          {fields.message('name')}
        </div>
        <div className="field">
          <label htmlFor={fields.id('currency')}>Default currency</label>
          <input
            {...fields.field('currency')}
            value={currency}
            maxLength={3}
            autoCapitalize="characters"
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
          {fields.message('currency')}
        </div>
        <div className="field">
          <label htmlFor={fields.id('rate')}>Default hourly rate</label>
          <input {...fields.field('rate')} inputMode="decimal" value={rate} placeholder="No rate" onChange={(event) => setRate(event.target.value)} />
          {fields.message('rate')}
        </div>
        <p className="hint field-full">Billable entries on projects without their own rate use this rate.</p>
        <label className="field">
          <span>Round durations in reports</span>
          <select value={roundingMinutes} onChange={(event) => setRoundingMinutes(Number(event.target.value))}>
            {steps.map((minutes) => <option key={minutes} value={minutes}>{stepLabel(minutes)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Rounding direction</span>
          <select value={rounding} disabled={roundingMinutes === 0} onChange={(event) => setRounding(Number(event.target.value))}>
            {ROUNDING_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
          </select>
        </label>
        <p className="hint field-full">
          The Reports page rounds each entry. Tracked entries keep their exact times. Toggl API report calls round only when they ask for it.
        </p>
      </div>
    </SettingsCard>
  );
}

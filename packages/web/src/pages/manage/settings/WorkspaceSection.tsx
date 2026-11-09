import { useState } from 'react';
import { accountRequests, useWid, type WorkspaceChanges } from '../../../api/account.ts';
import { stale } from '../../../api/keys.ts';
import type { Workspace } from '@tokkl/types';
import { useFieldErrors } from '../../../components/FieldError.tsx';
import { useAction } from '../../../components/useAction.ts';
import { parseOptionalAmount } from '../values.ts';
import { SettingsCard } from './SettingsCard.tsx';
import { t } from '../../../i18n/messages.ts';

/** The rounding steps Toggl accepts, in minutes. */
const ROUNDING_MINUTES = [0, 1, 5, 6, 10, 12, 15, 30, 60, 240] as const;

const ROUNDING_MODES = [
  { value: 0, label: 'settings.roundNearest' },
  { value: 1, label: 'settings.roundUp' },
  { value: -1, label: 'settings.roundDown' },
] as const;

function stepLabel(minutes: number): string {
  if (minutes === 0) return t('settings.dontRound');
  if (minutes % 60 === 0) return t('settings.stepHours', { count: minutes / 60 });
  return t('settings.stepMinutes', { count: minutes });
}

export function WorkspaceSection({ workspace }: { workspace: Workspace }) {
  const wid = useWid();
  const fields = useFieldErrors<'name' | 'currency' | 'rate'>();
  const [name, setName] = useState(workspace.name);
  const [currency, setCurrency] = useState(workspace.default_currency);
  const [rate, setRate] = useState(workspace.default_hourly_rate === null ? '' : String(workspace.default_hourly_rate));
  const [rounding, setRounding] = useState(workspace.rounding);
  const [roundingMinutes, setRoundingMinutes] = useState(workspace.rounding_minutes);

  const save = useAction<WorkspaceChanges>({
    mutationFn: body => accountRequests.saveWorkspace(wid, body),
    invalidate: stale.workspace,
    success: t('settings.workspaceSaved'),
  });

  const submit = () => {
    const code = currency.trim().toUpperCase();
    const parsedRate = parseOptionalAmount(rate);
    const valid = fields.validate([
      ['name', !name.trim() && t('settings.enterWorkspaceName')],
      ['currency', !/^[A-Z]{3}$/.test(code) && t('settings.currencyInvalid')],
      ['rate', parsedRate === undefined && t('settings.rateInvalid')],
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

  const steps: number[] = ROUNDING_MINUTES.some(step => step === roundingMinutes)
    ? [...ROUNDING_MINUTES]
    : [...ROUNDING_MINUTES, roundingMinutes].sort((a, b) => a - b);

  return (
    <SettingsCard id="workspace" title={t('settings.sectionWorkspace')} onSubmit={submit} saving={save.isPending}>
      <div className="form-grid">
        <div className="field field-full">
          <label htmlFor={fields.id('name')}>{t('settings.name')}</label>
          <input
            {...fields.field('name')}
            value={name}
            maxLength={140}
            onChange={event => setName(event.target.value)}
          />
          {fields.message('name')}
        </div>
        <div className="field">
          <label htmlFor={fields.id('currency')}>{t('settings.defaultCurrency')}</label>
          <input
            {...fields.field('currency')}
            value={currency}
            maxLength={3}
            autoCapitalize="characters"
            onChange={event => setCurrency(event.target.value.toUpperCase())}
          />
          {fields.message('currency')}
        </div>
        <div className="field">
          <label htmlFor={fields.id('rate')}>{t('settings.defaultHourlyRate')}</label>
          <input
            {...fields.field('rate')}
            inputMode="decimal"
            value={rate}
            placeholder={t('settings.noRate')}
            onChange={event => setRate(event.target.value)}
          />
          {fields.message('rate')}
        </div>
        <p className="hint field-full">{t('settings.rateHint')}</p>
        <label className="field">
          <span>{t('settings.roundDurations')}</span>
          <select value={roundingMinutes} onChange={event => setRoundingMinutes(Number(event.target.value))}>
            {steps.map(minutes => (
              <option key={minutes} value={minutes}>
                {stepLabel(minutes)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('settings.roundingDirection')}</span>
          <select
            value={rounding}
            disabled={roundingMinutes === 0}
            onChange={event => setRounding(Number(event.target.value))}
          >
            {ROUNDING_MODES.map(mode => (
              <option key={mode.value} value={mode.value}>
                {t(mode.label)}
              </option>
            ))}
          </select>
        </label>
        <p className="hint field-full">{t('settings.roundingHint')}</p>
      </div>
    </SettingsCard>
  );
}

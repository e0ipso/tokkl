import { useMemo, useState } from 'react';
import { canonicalTimeZone } from '@tokkl/common/time';
import { accountRequests, type ProfileChanges } from '../../../api/account.ts';
import { stale } from '../../../api/keys.ts';
import type { Me } from '../../../api/types.ts';
import { useFieldErrors } from '../../../components/FieldError.tsx';
import { useAction } from '../../../components/useAction.ts';
import { SettingsCard } from './SettingsCard.tsx';
import { browserTimeZone } from '../../../lib/browserTimeZone.ts';
import { dayOfWeekName } from '../../../lib/format.ts';
import { t } from '../../../i18n/messages.ts';
import { tx } from '../../../i18n/rich.ts';

/** The days a week can start on, Sunday first, as the account stores them. */
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

function timeZones(current: string): string[] {
  const zones = new Set(Intl.supportedValuesOf('timeZone'));
  // Some browsers leave UTC out of the list, and the account may use a zone this browser doesn't know.
  zones.add('UTC');
  zones.add(current);
  return [...zones].sort((a, b) => a.localeCompare(b));
}

// The server stores the name its ICU resolves (Asia/Calcutta) and some browsers resolve the current
// one (Asia/Kolkata). Resolving both names in this browser makes the two spellings of a zone match.
function sameZone(a: string, b: string): boolean {
  return a === b || (canonicalTimeZone(a) ?? a) === (canonicalTimeZone(b) ?? b);
}

export function ProfileSection({ me }: { me: Me }) {
  const fields = useFieldErrors<'email'>();
  const [fullname, setFullname] = useState(me.fullname);
  const [email, setEmail] = useState(me.email);
  const [timezone, setTimezone] = useState(me.timezone);
  const [weekStart, setWeekStart] = useState(me.beginning_of_week);
  const zones = useMemo(() => timeZones(me.timezone), [me.timezone]);
  const browserZone = browserTimeZone();

  const save = useAction<ProfileChanges>({
    mutationFn: accountRequests.saveProfile,
    // Day boundaries depend on the timezone and week start, so entry lists and reports refetch too.
    invalidate: stale.profile,
    success: t('settings.profileSaved'),
  });

  const submit = () => {
    if (!fields.validate([['email', !/^[^@\s]+@[^@\s]+$/.test(email.trim()) && t('settings.enterValidEmail')]])) return;
    save.mutate({ fullname: fullname.trim(), email: email.trim(), timezone, beginning_of_week: weekStart });
  };

  return (
    <SettingsCard id="profile" title={t('settings.sectionProfile')} onSubmit={submit} saving={save.isPending}>
      <div className="form-grid">
        <label className="field">
          <span>{t('settings.fullName')}</span>
          <input
            value={fullname}
            maxLength={255}
            autoComplete="name"
            onChange={event => setFullname(event.target.value)}
          />
        </label>
        <div className="field">
          <label htmlFor={fields.id('email')}>{t('settings.email')}</label>
          <input
            {...fields.field('email')}
            type="email"
            value={email}
            maxLength={255}
            autoComplete="email"
            required
            onChange={event => setEmail(event.target.value)}
          />
          {fields.message('email')}
        </div>
        <label className="field">
          <span>{t('settings.timezone')}</span>
          <select value={timezone} onChange={event => setTimezone(event.target.value)}>
            {zones.map(zone => (
              <option key={zone} value={zone}>
                {zone.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('settings.firstDayOfWeek')}</span>
          <select value={weekStart} onChange={event => setWeekStart(Number(event.target.value))}>
            {WEEKDAYS.map(day => (
              <option key={day} value={day}>
                {dayOfWeekName(day)}
              </option>
            ))}
          </select>
        </label>
        <p className="hint field-full">{t('settings.profileHint')}</p>
        {browserZone && !sameZone(browserZone, me.timezone) ? (
          <div className="settings-notice field-full" role="note">
            <span>
              {tx('settings.browserZone', {
                browser: <strong>{browserZone}</strong>,
                account: <strong>{me.timezone}</strong>,
              })}
            </span>
            {timezone !== browserZone ? (
              <button type="button" className="button button-ghost" onClick={() => setTimezone(browserZone)}>
                {t('settings.useZone', { zone: browserZone })}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </SettingsCard>
  );
}

import { useMemo, useState } from 'react';
import { api } from '../../../api/client.ts';
import { keys } from '../../../api/hooks.ts';
import type { Me } from '../../../api/types.ts';
import { useFieldErrors } from '../../../components/FieldError.tsx';
import { useAction, V9 } from '../queries.ts';
import { SettingsCard } from './SettingsCard.tsx';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

type ProfileBody = Pick<Me, 'fullname' | 'email' | 'timezone' | 'beginning_of_week'>;

function timeZones(current: string): string[] {
  const zones = new Set(Intl.supportedValuesOf('timeZone'));
  // Some browsers leave UTC out of the list, and the account may use a zone this browser doesn't know.
  zones.add('UTC');
  zones.add(current);
  return [...zones].sort((a, b) => a.localeCompare(b));
}

export function ProfileSection({ me }: { me: Me }) {
  const fields = useFieldErrors<'email'>();
  const [fullname, setFullname] = useState(me.fullname);
  const [email, setEmail] = useState(me.email);
  const [timezone, setTimezone] = useState(me.timezone);
  const [weekStart, setWeekStart] = useState(me.beginning_of_week);
  const zones = useMemo(() => timeZones(me.timezone), [me.timezone]);
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const save = useAction<ProfileBody, Me>({
    mutationFn: (body) => api.put<Me>(`${V9}/me`, body),
    // Day boundaries depend on the timezone and week start, so entry lists and reports refetch too.
    invalidate: [keys.me, keys.entries, keys.current, keys.report],
    success: 'Profile saved',
  });

  const submit = () => {
    if (!fields.validate([['email', !/^[^@\s]+@[^@\s]+$/.test(email.trim()) && 'Enter a valid email address']])) return;
    save.mutate({ fullname: fullname.trim(), email: email.trim(), timezone, beginning_of_week: weekStart });
  };

  return (
    <SettingsCard id="profile" title="Profile" onSubmit={submit} saving={save.isPending}>
      <div className="form-grid">
        <label className="field">
          <span>Full name</span>
          <input value={fullname} maxLength={255} autoComplete="name" onChange={(event) => setFullname(event.target.value)} />
        </label>
        <div className="field">
          <label htmlFor={fields.id('email')}>Email</label>
          <input {...fields.field('email')} type="email" value={email} maxLength={255} autoComplete="email" required onChange={(event) => setEmail(event.target.value)} />
          {fields.message('email')}
        </div>
        <label className="field">
          <span>Timezone</span>
          <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
            {zones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}
          </select>
        </label>
        <label className="field">
          <span>First day of the week</span>
          <select value={weekStart} onChange={(event) => setWeekStart(Number(event.target.value))}>
            {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
          </select>
        </label>
        <p className="hint field-full">
          The account timezone decides which day an entry belongs to in lists, reports and imports. You use the email to log in.
        </p>
        {browserZone && browserZone !== me.timezone ? (
          <div className="settings-notice field-full" role="note">
            <span>
              This browser is set to <strong>{browserZone}</strong>, but the account uses <strong>{me.timezone}</strong>.
            </span>
            {timezone !== browserZone ? (
              <button type="button" className="button button-ghost" onClick={() => setTimezone(browserZone)}>
                Use {browserZone}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </SettingsCard>
  );
}

import { useRef, useState } from 'react';
import type { PomodoroLimits, Preferences, TimeEntry } from '@tokkl/types';
import { EntryFields } from '../../components/EntryFields.tsx';
import { LengthStepper, LengthStepperGrid } from '../../components/LengthStepper.tsx';
import { usePomodoroSession } from '../../components/PomodoroSessionProvider.tsx';
import { EMPTY_DRAFT, type EntryDraft } from '../../components/useEntryFields.ts';
import { LENGTH_FIELDS, lengthText, sessionConfig, type LengthEdits, type LengthKey } from './sessionLengths.ts';
import { t } from '../../i18n/messages.ts';

/** The lengths apply to this session only, within the server's `limits`. */
export function StartForm({
  preferences,
  limits,
  recentEntries,
}: {
  preferences: Preferences;
  limits: PomodoroLimits;
  recentEntries: TimeEntry[];
}) {
  const { start, busy, unlockAudio } = usePomodoroSession();
  const [lengthEdits, setLengthEdits] = useState<LengthEdits>({});
  const [draft, setDraft] = useState<EntryDraft>(EMPTY_DRAFT);
  const inputs = useRef(new Map<LengthKey, HTMLInputElement>());
  const form = useRef<HTMLFormElement>(null);

  const startSession = () => {
    if (busy) return;
    const lengths = sessionConfig(lengthEdits, preferences, limits);
    // The cards already show which lengths are out of range; Start moves focus to the first one.
    if ('invalid' in lengths) {
      inputs.current.get(lengths.invalid)?.focus();
      return;
    }
    unlockAudio();
    void start(lengths.config, draft);
  };

  return (
    <form
      ref={form}
      className="card pomodoro-card"
      aria-label={t('pomodoro.startLabel')}
      noValidate
      onSubmit={event => {
        event.preventDefault();
        startSession();
      }}
    >
      <h2>{t('pomodoro.startHeading')}</h2>
      <p className="hint">{t('pomodoro.startHint')}</p>
      <LengthStepperGrid>
        {LENGTH_FIELDS.map(field => (
          <LengthStepper
            key={field.key}
            label={t(field.label)}
            unit={t(field.unit)}
            spokenUnit={t(field.spokenUnit)}
            range={limits[field.limit]}
            value={lengthText(lengthEdits, preferences, limits, field)}
            onChange={text => setLengthEdits(current => ({ ...current, [field.key]: text }))}
            inputProps={{
              ref: element => {
                if (element) inputs.current.set(field.key, element);
                else inputs.current.delete(field.key);
              },
            }}
          />
        ))}
      </LengthStepperGrid>
      <fieldset className="pomodoro-entry-fields">
        <legend>{t('pomodoro.entryDetails')}</legend>
        <EntryFields
          draft={draft}
          recentEntries={recentEntries}
          placeholder={t('pomodoro.startPlaceholder')}
          onType={description => setDraft(current => ({ ...current, description }))}
          onEdit={changes => setDraft(current => ({ ...current, ...changes }))}
          onDescriptionBlur={() => {}}
          onEnter={() => form.current?.requestSubmit()}
        />
      </fieldset>
      <button type="submit" className="button button-primary" disabled={busy}>
        {t('pomodoro.start')}
      </button>
    </form>
  );
}

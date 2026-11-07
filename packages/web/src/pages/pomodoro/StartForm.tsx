import { useRef, useState } from 'react';
import { POMODORO_SESSION_CONFIG_RANGES } from '@tokkl/common/pomodoroSession';
import type { Preferences, TimeEntry } from '../../api/types.ts';
import { EntryFields } from '../../components/EntryFields.tsx';
import { LengthStepper, LengthStepperGrid } from '../../components/LengthStepper.tsx';
import { usePomodoroSession } from '../../components/PomodoroSessionProvider.tsx';
import { EMPTY_DRAFT, type EntryDraft } from '../../components/useEntryFields.ts';
import { LENGTH_FIELDS, lengthText, sessionConfig, type LengthEdits, type LengthKey } from './sessionLengths.ts';

/** The lengths and entry fields of a new session. The lengths apply to this session only. */
export function StartForm({ preferences, recentEntries }: { preferences: Preferences; recentEntries: TimeEntry[] }) {
  const { start, busy, unlockAudio } = usePomodoroSession();
  const [lengthEdits, setLengthEdits] = useState<LengthEdits>({});
  const [draft, setDraft] = useState<EntryDraft>(EMPTY_DRAFT);
  const inputs = useRef(new Map<LengthKey, HTMLInputElement>());
  const form = useRef<HTMLFormElement>(null);

  const startSession = () => {
    if (busy) return;
    const lengths = sessionConfig(lengthEdits, preferences);
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
      aria-label="Start a Pomodoro session"
      noValidate
      onSubmit={event => {
        event.preventDefault();
        startSession();
      }}
    >
      <h2>Start a session</h2>
      <p className="hint">These lengths apply to this session. Your saved preferences stay the same.</p>
      <LengthStepperGrid>
        {LENGTH_FIELDS.map(field => (
          <LengthStepper
            key={field.key}
            label={field.label}
            unit={field.unit}
            spokenUnit={field.spokenUnit}
            range={POMODORO_SESSION_CONFIG_RANGES[field.key]}
            value={lengthText(lengthEdits, preferences, field)}
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
        <legend>Entry details</legend>
        <EntryFields
          draft={draft}
          recentEntries={recentEntries}
          placeholder="What will you work on?"
          onType={description => setDraft(current => ({ ...current, description }))}
          onEdit={changes => setDraft(current => ({ ...current, ...changes }))}
          onDescriptionBlur={() => {}}
          onEnter={() => form.current?.requestSubmit()}
        />
      </fieldset>
      <button type="submit" className="button button-primary" disabled={busy}>
        Start
      </button>
    </form>
  );
}

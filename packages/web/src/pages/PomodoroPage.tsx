import { addDays } from '@tokkl/common/time';
import { usePreferences } from '../api/account.ts';
import { useEntries } from '../api/entries.ts';
import { useSettings } from '../api/settings.ts';
import { AllowNotifications } from '../components/AllowNotifications.tsx';
import { LoadError, Loading } from '../components/PageState.tsx';
import { usePomodoroSession } from '../components/PomodoroSessionProvider.tsx';
import { today } from '../lib/format.ts';
import { RunningSession } from './pomodoro/RunningSession.tsx';
import { StartForm } from './pomodoro/StartForm.tsx';
import './PomodoroPage.css';

export function PomodoroPage() {
  const { session } = usePomodoroSession();
  const { data: preferences, error, refetch } = usePreferences();
  const settings = useSettings();
  const day = today(settings.timeZone);
  const { data: recentEntries = [] } = useEntries(addDays(day, -13), addDays(day, 2));

  return (
    <div className="page pomodoro-page">
      <header className="page-header">
        <h1>Pomodoro</h1>
      </header>
      {session ? (
        <RunningSession recentEntries={recentEntries} />
      ) : preferences ? (
        <StartForm preferences={preferences} recentEntries={recentEntries} />
      ) : error ? (
        <LoadError message={`Could not load preferences: ${error.message}`} onRetry={() => void refetch()} />
      ) : (
        <Loading label="Loading preferences…" />
      )}
      <div className="pomodoro-notifications">
        <AllowNotifications />
      </div>
    </div>
  );
}

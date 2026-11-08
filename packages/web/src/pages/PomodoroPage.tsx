import { addDays } from '@tokkl/common/time';
import { usePreferences } from '../api/account.ts';
import { usePomodoroLimits } from '../api/auth.ts';
import { useEntries } from '../api/entries.ts';
import { useSettings } from '../api/settings.ts';
import { AllowNotifications } from '../components/AllowNotifications.tsx';
import { LoadError, Loading } from '../components/PageState.tsx';
import { usePomodoroSession } from '../components/PomodoroSessionProvider.tsx';
import { t } from '../i18n/messages.ts';
import { today } from '../lib/format.ts';
import { RunningSession } from './pomodoro/RunningSession.tsx';
import { StartForm } from './pomodoro/StartForm.tsx';

export function PomodoroPage() {
  const { session } = usePomodoroSession();
  const { data: preferences, error: preferencesError, refetch: refetchPreferences } = usePreferences();
  const { data: limits, error: limitsError, refetch: refetchLimits } = usePomodoroLimits();
  const error = preferencesError ?? limitsError;
  const retry = () => {
    if (preferencesError) void refetchPreferences();
    if (limitsError) void refetchLimits();
  };
  const settings = useSettings();
  const day = today(settings.timeZone);
  const { data: recentEntries = [] } = useEntries(addDays(day, -13), addDays(day, 2));

  return (
    <div className="page pomodoro-page">
      <header className="page-header">
        <h1>{t('pomodoro.title')}</h1>
      </header>
      {session ? (
        <RunningSession recentEntries={recentEntries} />
      ) : preferences && limits ? (
        <StartForm preferences={preferences} limits={limits} recentEntries={recentEntries} />
      ) : error ? (
        <LoadError message={t('pomodoro.loadFailed', { message: error.message })} onRetry={retry} />
      ) : (
        <Loading label={t('pomodoro.loadingPreferences')} />
      )}
      <div className="pomodoro-notifications">
        <AllowNotifications />
      </div>
    </div>
  );
}

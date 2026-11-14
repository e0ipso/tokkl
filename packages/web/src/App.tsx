import { useLayoutEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRoute } from 'wouter';
import { useMe } from './api/account.ts';
import { useAppStatus } from './api/auth.ts';
import { isApiError } from './api/client.ts';
import { TimerStateProvider } from './api/TimerStateProvider.tsx';
import { Shell } from './app/Shell.tsx';
import { Brand } from './components/Brand.tsx';
import { LoadError, Loading } from './components/PageState.tsx';
import { PomodoroSessionProvider } from './components/PomodoroSessionProvider.tsx';
import { t } from './i18n/messages.ts';
import { endSession } from './lib/session.ts';
import { AuthPage } from './pages/AuthPage.tsx';
import { InvitePage } from './pages/InvitePage.tsx';
import { ResetPasswordPage } from './pages/ResetPasswordPage.tsx';
import { SignupPage } from './pages/SignupPage.tsx';

/**
 * Ends the session once per 403 from /me; the clear re-renders App, and the second 403 does nothing.
 * Runs before paint, so the login page never shows in the previous user's theme.
 */
function useEndSessionOnForbidden(forbidden: boolean, signedIn: boolean) {
  const qc = useQueryClient();
  const [ended, setEnded] = useState(false);
  if (signedIn && ended) setEnded(false);
  useLayoutEffect(() => {
    if (signedIn || !forbidden || ended) return;
    endSession(qc);
    // qc.clear() notifies no mounted query, so this state change re-renders App; the clear must run once, before paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnded(true);
  }, [forbidden, signedIn, ended, qc]);
}

function Splash({ children }: { children: ReactNode }) {
  return (
    <div className="splash">
      <Brand size="lg" />
      {children}
    </div>
  );
}

/** One-time link pages, first-run setup, the login page, or the signed-in app. */
export function App() {
  const status = useAppStatus();
  const me = useMe();
  const forbidden = isApiError(me.error, 403);
  useEndSessionOnForbidden(forbidden, me.isSuccess);
  const [isInvite, invite] = useRoute('/invite/:token');
  const [isReset, reset] = useRoute('/reset/:token');
  const [isSignup] = useRoute('/signup');

  // Reachable signed in or not: accepting an invite starts the new account's session.
  if (isInvite) return <InvitePage key={invite.token} token={invite.token} />;
  // Reachable signed in or not: the person resetting has usually lost access to the account.
  if (isReset) return <ResetPasswordPage key={reset.token} token={reset.token} />;
  if (isSignup) return <SignupPage />;
  // isPending, not isLoading: a retry pauses while the tab is hidden or offline, and a paused query has no data.
  // The signed-in app below needs /me, so it must wait for it.
  if (status.isPending || (me.isPending && !status.data?.setup_required)) {
    return (
      <Splash>
        <Loading />
      </Splash>
    );
  }
  if (status.data?.setup_required) return <AuthPage mode="setup" />;
  if (forbidden) return <AuthPage mode="login" signupEnabled={status.data?.signup_enabled === true} />;
  if (me.error) {
    const retry = () => {
      if (status.error) void status.refetch();
      void me.refetch();
    };
    return (
      <Splash>
        <LoadError message={t('shell.serverUnreachable', { message: me.error.message })} onRetry={retry} />
      </Splash>
    );
  }
  return (
    <TimerStateProvider>
      <PomodoroSessionProvider>
        <Shell />
      </PomodoroSessionProvider>
    </TimerStateProvider>
  );
}

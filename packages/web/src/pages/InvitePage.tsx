import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ApiError, api } from '../api/client.ts';
import { Brand } from '../components/Brand.tsx';
import { FieldError } from '../components/FieldError.tsx';
import { Icon } from '../components/Icon.tsx';
import { LoadError, Loading } from '../components/PageState.tsx';

type InviteCheck =
  | { state: 'loading' }
  | { state: 'valid'; role: 'admin' | 'user' }
  | { state: 'error'; message: string; invalid: boolean };

/**
 * Checks the invite token once. Plain state rather than a query: the app clears the query cache
 * when the logged-out /me check fails, and this check must survive that.
 */
function useInviteCheck(path: string): [InviteCheck, () => void] {
  const [check, setCheck] = useState<InviteCheck>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setCheck({ state: 'loading' });
    api.get<{ role: 'admin' | 'user' }>(path).then(
      ({ role }) => { if (current) setCheck({ state: 'valid', role }); },
      (error: unknown) => {
        if (!current) return;
        const message = error instanceof Error ? error.message : String(error);
        setCheck({ state: 'error', message, invalid: error instanceof ApiError && error.status === 404 });
      },
    );
    return () => { current = false; };
  }, [path, attempt]);
  return [check, () => setAttempt((n) => n + 1)];
}

/** /invite/:token, reachable while logged out. Creates the invited account and lands on the timer. */
export function InvitePage({ token }: { token: string }) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const path = `/api/app/invites/${encodeURIComponent(token)}`;
  const [check, retry] = useInviteCheck(path);
  const [fullname, setFullname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(path, { email, password, fullname, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      // Load the new account before leaving, so the timer renders signed in rather than the login form.
      await qc.resetQueries();
      setLocation('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  if (check.state === 'loading') {
    return <div className="splash"><Brand size="lg" /><Loading label="Checking your invite…" /></div>;
  }
  if (check.state === 'error') {
    return (
      <div className="splash">
        <Brand size="lg" />
        <LoadError
          title={check.invalid ? 'Invite link not valid' : undefined}
          message={check.invalid ? check.message : `Can't check this invite: ${check.message}`}
          onRetry={check.invalid ? undefined : retry}
        />
        <a className="button button-ghost" href="/">Go to log in</a>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <Brand size="lg" />
      <form className="auth-card" onSubmit={submit}>
        <h1>Create your account</h1>
        <p className="muted">
          {check.role === 'admin'
            ? 'You are invited as an administrator of this Tokkl server.'
            : 'You are invited to track time on this Tokkl server.'}
          {' '}Your entries stay private to your account.
        </p>
        <label className="field">
          <span>Name</span>
          <input value={fullname} onChange={(e) => setFullname(e.target.value)} autoComplete="name" autoFocus />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        {error ? (
          <div className="auth-error">
            <Icon name="alert" className="error-icon" />
            <FieldError message={error} />
          </div>
        ) : null}
        <button type="submit" className="button button-primary button-block" disabled={busy}>
          Create account
        </button>
      </form>
    </div>
  );
}

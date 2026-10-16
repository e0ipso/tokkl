import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { api } from '../api/client.ts';
import { Brand } from '../components/Brand.tsx';
import { FieldError } from '../components/FieldError.tsx';
import { Icon } from '../components/Icon.tsx';
import { LinkCheckSplash, useLinkCheck } from './linkCheck.tsx';

/** /invite/:token, reachable while logged out. Creates the invited account and lands on the timer. */
export function InvitePage({ token }: { token: string }) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const path = `/api/app/invites/${encodeURIComponent(token)}`;
  const [check, retry] = useLinkCheck<{ role: 'admin' | 'user' }>(path);
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

  if (check.state !== 'valid') {
    return (
      <LinkCheckSplash
        check={check}
        retry={retry}
        loadingLabel="Checking your invite…"
        invalidTitle="Invite link not valid"
        failurePrefix="Can't check this invite"
      />
    );
  }

  return (
    <div className="auth-page">
      <Brand size="lg" />
      <form className="auth-card" onSubmit={submit}>
        <h1>Create your account</h1>
        <p className="muted">
          {check.data.role === 'admin'
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

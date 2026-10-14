import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.ts';

export function AuthPage({ mode }: { mode: 'login' | 'setup' }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullname, setFullname] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'setup') {
        await api.post('/api/app/setup', {
          setup_code: setupCode, email, password, fullname,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      } else {
        await api.post('/api/app/login', { email, password });
      }
      await qc.resetQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <img src="/icon.svg" alt="" width={36} height={36} />
          <span>Timetrack</span>
        </div>
        {mode === 'setup' ? (
          <>
            <h1>Create your account</h1>
            <p className="muted">
              This server has no account yet. The setup code is printed in the server log.
            </p>
            <label className="field">
              <span>Setup code</span>
              <input value={setupCode} onChange={(e) => setSetupCode(e.target.value)} required autoComplete="off" autoFocus />
            </label>
            <label className="field">
              <span>Name</span>
              <input value={fullname} onChange={(e) => setFullname(e.target.value)} autoComplete="name" />
            </label>
          </>
        ) : <h1>Log in</h1>}
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" autoFocus={mode === 'login'} />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'setup' ? 8 : undefined}
            autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
          />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button type="submit" className="button button-primary button-block" disabled={busy}>
          {mode === 'setup' ? 'Create account' : 'Log in'}
        </button>
      </form>
    </div>
  );
}

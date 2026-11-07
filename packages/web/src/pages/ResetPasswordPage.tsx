import { useState } from 'react';
import { authRequests } from '../api/auth.ts';
import { isApiError } from '../api/client.ts';
import { Brand } from '../components/Brand.tsx';
import { useFieldErrors } from '../components/FieldError.tsx';
import { FormError, errorMessage } from '../components/FormError.tsx';
import { LinkCheckSplash, useLinkCheck } from './linkCheck.tsx';

/**
 * /reset/:token, reachable while logged out. Sets a new password from an admin's one-time link.
 * The server signs the account out everywhere and starts no session, so the page ends with a link
 * to the login form.
 */
export function ResetPasswordPage({ token }: { token: string }) {
  const [check, retry] = useLinkCheck(token, authRequests.checkReset);
  const fields = useFieldErrors<'password'>();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authRequests.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      // The link was checked on load, so a 400 is the server's password rules; anything else, such
      // as a spent link or too many attempts, is about the page.
      if (isApiError(err, 400)) fields.validate([['password', err.message]]);
      else setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (check.state !== 'valid') {
    return (
      <LinkCheckSplash
        check={check}
        retry={retry}
        loadingLabel="Checking your reset link…"
        invalidTitle="Reset link not valid"
        failurePrefix="Can't check this reset link"
      />
    );
  }

  if (done) {
    return (
      <div className="auth-page">
        <Brand size="lg" />
        <div className="auth-card" role="status">
          <h1>Password changed</h1>
          <p className="muted">
            Log in as {check.data.email} with your new password. Every browser that was signed in to this account is now
            signed out.
          </p>
          <a className="button button-primary button-block" href="/">
            Go to log in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <Brand size="lg" />
      <form className="auth-card" onSubmit={submit}>
        <h1>Set a new password</h1>
        <p className="muted">Choose a new password for {check.data.email}. This link works once.</p>
        {/* Lets a password manager save the new password under the right account. */}
        <input type="email" value={check.data.email} autoComplete="username" readOnly hidden />
        <div className="field">
          <label htmlFor={fields.id('password')}>New password</label>
          <input
            {...fields.field('password')}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            autoFocus
          />
          {fields.message('password')}
        </div>
        <FormError message={error} />
        <button type="submit" className="button button-primary button-block" disabled={busy}>
          Set password
        </button>
      </form>
    </div>
  );
}

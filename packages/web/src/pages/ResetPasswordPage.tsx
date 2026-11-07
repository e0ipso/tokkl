import { useState } from 'react';
import { authRequests } from '../api/auth.ts';
import { isApiError } from '../api/client.ts';
import { Brand } from '../components/Brand.tsx';
import { useFieldErrors } from '../components/FieldError.tsx';
import { FormError, errorMessage } from '../components/FormError.tsx';
import { LinkCheckSplash, useLinkCheck } from './linkCheck.tsx';
import { t } from '../i18n/messages.ts';

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
        loadingLabel={t('auth.checkingReset')}
        invalidTitle={t('auth.resetInvalid')}
        failurePrefix={t('auth.resetCheckFailed')}
      />
    );
  }

  if (done) {
    return (
      <div className="auth-page">
        <Brand size="lg" />
        <div className="auth-card" role="status">
          <h1>{t('auth.passwordChanged')}</h1>
          <p className="muted">{t('auth.passwordChangedBody', { email: check.data.email })}</p>
          <a className="button button-primary button-block" href="/">
            {t('auth.goToLogIn')}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <Brand size="lg" />
      <form className="auth-card" onSubmit={submit}>
        <h1>{t('auth.setNewPassword')}</h1>
        <p className="muted">{t('auth.chooseNewPassword', { email: check.data.email })}</p>
        {/* Lets a password manager save the new password under the right account. */}
        <input type="email" value={check.data.email} autoComplete="username" readOnly hidden />
        <div className="field">
          <label htmlFor={fields.id('password')}>{t('auth.newPassword')}</label>
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
          {t('auth.setPassword')}
        </button>
      </form>
    </div>
  );
}

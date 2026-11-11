import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { authRequests } from '../api/auth.ts';
import { isApiError } from '../api/client.ts';
import { Brand } from '../components/Brand.tsx';
import { useFieldErrors } from '../components/FieldError.tsx';
import { FormError, errorMessage } from '../components/FormError.tsx';
import { t } from '../i18n/messages.ts';

/** A public request for an emailed invite, with the same reply for every accepted address. */
export function SignupPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'form' | 'done' | 'unavailable'>('form');
  const [error, setError] = useState<string | null>(null);
  const fields = useFieldErrors<'email'>();
  const result = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state !== 'form') result.current?.focus();
  }, [state]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    fields.clear('email');
    try {
      await authRequests.signup(email);
      setState('done');
    } catch (err) {
      if (isApiError(err, 400)) fields.validate([['email', err.message]]);
      else if (isApiError(err, 404)) setState('unavailable');
      else if (isApiError(err, 429) && err.retryAfter) {
        setError(t('auth.signupRetryAfter', { seconds: err.retryAfter }));
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <Brand size="lg" />
      {state !== 'form' ? (
        <div className="auth-card" role={state === 'done' ? 'status' : 'alert'} tabIndex={-1} ref={result}>
          <h1>{t(state === 'done' ? 'auth.checkInbox' : 'auth.signupUnavailable')}</h1>
          {state === 'done' && <p className="muted">{t('auth.checkInboxBody')}</p>}
          <Link className="button button-primary button-block" href="/">
            {t('auth.goToLogIn')}
          </Link>
        </div>
      ) : (
        <form className="auth-card" onSubmit={submit}>
          <h1>{t('auth.signupTitle')}</h1>
          <p className="muted">{t('auth.signupIntro')}</p>
          <div className="field">
            <label htmlFor={fields.id('email')}>{t('auth.email')}</label>
            <input
              {...fields.field('email')}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus
            />
            {fields.message('email')}
          </div>
          <FormError message={error} />
          <button type="submit" className="button button-primary button-block" disabled={busy}>
            {t('auth.sendSignupLink')}
          </button>
          <Link href="/">{t('auth.goToLogIn')}</Link>
        </form>
      )}
    </div>
  );
}

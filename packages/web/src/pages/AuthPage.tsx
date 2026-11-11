import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { authRequests } from '../api/auth.ts';
import { Brand } from '../components/Brand.tsx';
import { FormError, errorMessage } from '../components/FormError.tsx';
import { browserTimeZone } from '../lib/browserTimeZone.ts';
import { t } from '../i18n/messages.ts';
import { tx } from '../i18n/rich.ts';

export function AuthPage({ mode, signupEnabled = false }: { mode: 'login' | 'setup'; signupEnabled?: boolean }) {
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
        await authRequests.setup({
          setup_code: setupCode,
          email,
          password,
          fullname,
          timezone: browserTimeZone(),
        });
      } else {
        await authRequests.login({ email, password });
      }
      await qc.resetQueries();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <Brand size="lg" />
      <form className="auth-card" onSubmit={submit}>
        {mode === 'setup' ? (
          <>
            <h1>{t('auth.setupTitle')}</h1>
            <p className="muted">{t('auth.setupIntro')}</p>
            <label className="field">
              <span>{t('auth.setupCode')}</span>
              <input
                value={setupCode}
                onChange={e => setSetupCode(e.target.value)}
                required
                autoComplete="off"
                autoFocus
              />
            </label>
            <label className="field">
              <span>{t('auth.name')}</span>
              <input value={fullname} onChange={e => setFullname(e.target.value)} autoComplete="name" />
            </label>
          </>
        ) : (
          <h1>{t('auth.logIn')}</h1>
        )}
        <label className="field">
          <span>{t('auth.email')}</span>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="username"
            autoFocus={mode === 'login'}
          />
        </label>
        <label className="field">
          <span>{t('auth.password')}</span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={mode === 'setup' ? 8 : undefined}
            autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
          />
        </label>
        <FormError message={error} />
        <button type="submit" className="button button-primary button-block" disabled={busy}>
          {mode === 'setup' ? t('auth.createAdmin') : t('auth.logIn')}
        </button>
        {mode === 'login' && signupEnabled && <Link href="/signup">{t('auth.signupTitle')}</Link>}
      </form>
      {mode === 'login' && (
        <footer className="auth-links">
          <p className="hint">
            {tx('auth.openSource', {
              repository: <a href="https://github.com/e0ipso/tokkl">{t('auth.viewSource')}</a>,
            })}
          </p>
          <p className="hint">
            {tx('auth.androidIntro', {
              androidApp: <a href="https://github.com/e0ipso/tokkl-android/releases/latest">{t('auth.androidApp')}</a>,
            })}
          </p>
        </footer>
      )}
    </div>
  );
}

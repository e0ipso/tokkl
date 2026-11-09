import { useEffect, useState } from 'react';
import { isApiError } from '../api/client.ts';
import { Brand } from '../components/Brand.tsx';
import { LoadError, Loading } from '../components/PageState.tsx';
import { t } from '../i18n/messages.ts';

/** The answer to checking a one-time link, such as an invite or a password reset link. */
type LinkCheck<T> =
  { state: 'loading' } | { state: 'valid'; data: T } | { state: 'error'; message: string; invalid: boolean };

/**
 * Checks a one-time link's token once. Plain state rather than a query: the app clears the query
 * cache when the logged-out /me check fails, and this check must survive that. Each answer is kept
 * with the request it answers, so a new token or a retry shows loading until its own answer comes.
 */
export function useLinkCheck<T>(token: string, load: (token: string) => Promise<T>): [LinkCheck<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const request = `${attempt}:${token}`;
  const [answer, setAnswer] = useState<{ request: string; check: LinkCheck<T> } | null>(null);
  useEffect(() => {
    let current = true;
    load(token).then(
      data => {
        if (current) setAnswer({ request, check: { state: 'valid', data } });
      },
      (error: unknown) => {
        if (!current) return;
        const message = error instanceof Error ? error.message : String(error);
        setAnswer({ request, check: { state: 'error', message, invalid: isApiError(error, 404) } });
      },
    );
    return () => {
      current = false;
    };
  }, [token, load, request]);
  const check: LinkCheck<T> = answer?.request === request ? answer.check : { state: 'loading' };
  return [check, () => setAttempt(n => n + 1)];
}

/**
 * The full-page loading or error state of a link check. A 404 means the link is not valid and has
 * no retry; any other failure can be retried. Both offer the login page.
 */
export function LinkCheckSplash({
  check,
  retry,
  loadingLabel,
  invalidTitle,
  failurePrefix,
}: {
  check: Exclude<LinkCheck<unknown>, { state: 'valid' }>;
  retry: () => void;
  loadingLabel: string;
  invalidTitle: string;
  failurePrefix: string;
}) {
  if (check.state === 'loading') {
    return (
      <div className="splash">
        <Brand size="lg" />
        <Loading label={loadingLabel} />
      </div>
    );
  }
  return (
    <div className="splash">
      <Brand size="lg" />
      <LoadError
        title={check.invalid ? invalidTitle : undefined}
        message={
          check.invalid ? check.message : t('auth.checkFailed', { prefix: failurePrefix, message: check.message })
        }
        onRetry={check.invalid ? undefined : retry}
      />
      <a className="button button-ghost" href="/">
        {t('auth.goToLogIn')}
      </a>
    </div>
  );
}

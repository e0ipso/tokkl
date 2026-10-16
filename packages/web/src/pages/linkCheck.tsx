import { useEffect, useState } from 'react';
import { ApiError, api } from '../api/client.ts';
import { Brand } from '../components/Brand.tsx';
import { LoadError, Loading } from '../components/PageState.tsx';

/** The answer to checking a one-time link, such as an invite or a password reset link. */
export type LinkCheck<T> =
  | { state: 'loading' }
  | { state: 'valid'; data: T }
  | { state: 'error'; message: string; invalid: boolean };

/**
 * Checks a one-time link's token once. Plain state rather than a query: the app clears the query
 * cache when the logged-out /me check fails, and this check must survive that.
 */
export function useLinkCheck<T>(path: string): [LinkCheck<T>, () => void] {
  const [check, setCheck] = useState<LinkCheck<T>>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setCheck({ state: 'loading' });
    api.get<T>(path).then(
      (data) => { if (current) setCheck({ state: 'valid', data }); },
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

/**
 * The full-page loading or error state of a link check. A 404 means the link is not valid and has
 * no retry; any other failure can be retried. Both offer the login page.
 */
export function LinkCheckSplash({ check, retry, loadingLabel, invalidTitle, failurePrefix }: {
  check: Exclude<LinkCheck<unknown>, { state: 'valid' }>;
  retry: () => void;
  loadingLabel: string;
  invalidTitle: string;
  failurePrefix: string;
}) {
  if (check.state === 'loading') {
    return <div className="splash"><Brand size="lg" /><Loading label={loadingLabel} /></div>;
  }
  return (
    <div className="splash">
      <Brand size="lg" />
      <LoadError
        title={check.invalid ? invalidTitle : undefined}
        message={check.invalid ? check.message : `${failurePrefix}: ${check.message}`}
        onRetry={check.invalid ? undefined : retry}
      />
      <a className="button button-ghost" href="/">Go to log in</a>
    </div>
  );
}

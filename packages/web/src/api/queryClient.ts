import { QueryCache, QueryClient, focusManager } from '@tanstack/react-query';
import { isApiError } from './client.ts';
import { keys } from './keys.ts';

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: {
      /**
       * A 403 from this query means the credential is gone, not that the account lacks a right. It
       * asks /me again, and /me decides what the app shows (App's session gate).
       */
      sessionProbe?: boolean;
    };
  }
}

// TanStack Query only listens for visibilitychange. Clicking back into a window that stayed
// visible, such as one beside another app, fires focus alone, and the timer must refresh then
// too (docs/PRD.md C3). Visibility still decides whether the app counts as focused. Switching
// tabs fires both events, so one refresh per second is enough.
const REFOCUS_GAP_MS = 1000;

function listenForFocus(): void {
  focusManager.setEventListener(handleFocus => {
    let lastRefresh = -Infinity;
    const onChange = () => {
      if (document.visibilityState !== 'hidden') {
        const now = Date.now();
        if (now - lastRefresh < REFOCUS_GAP_MS) return;
        lastRefresh = now;
      }
      handleFocus();
    };
    window.addEventListener('visibilitychange', onChange, false);
    window.addEventListener('focus', onChange, false);
    return () => {
      window.removeEventListener('visibilitychange', onChange);
      window.removeEventListener('focus', onChange);
    };
  });
}

/**
 * The app's query client. Client errors (4xx) are not retried. A query marked `sessionProbe` that
 * answers 403 sends the app back to /me, the one place that ends a session.
 */
export function createQueryClient(): QueryClient {
  listenForFocus();
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.meta?.sessionProbe && isApiError(error, 403)) void client.invalidateQueries({ queryKey: keys.me });
      },
    }),
    defaultOptions: {
      queries: {
        retry: (count, error) => !(isApiError(error) && error.status < 500) && count < 2,
        refetchOnWindowFocus: true,
      },
    },
  });
  return client;
}

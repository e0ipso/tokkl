import { QueryCache, QueryClient, focusManager } from '@tanstack/react-query';
import { isApiError } from './client.ts';
import { keys } from './keys.ts';

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: {
      /** A 403 here means the credential is gone, so /me decides what the app shows. */
      sessionProbe?: boolean;
    };
    mutationMeta: {
      /** Timer actions wait for it. */
      movesTimer?: boolean;
    };
  }
}

// TanStack only listens for visibilitychange, but clicking back into a visible window fires focus alone.
// Switching tabs fires both, so one refresh per second is enough.
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

/** Client errors (4xx) are not retried. A `sessionProbe` 403 sends the app back to /me. */
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

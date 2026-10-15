// Reapplies the cached theme that web/public/theme-boot.js set before the first paint.
import './lib/theme.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { App } from './App.tsx';
import { ApiError } from './api/client.ts';
import { ToastProvider } from './components/Toast.tsx';
import './styles.css';

// TanStack Query only listens for visibilitychange. Clicking back into a window that stayed
// visible, such as one beside another app, fires focus alone, and the timer must refresh then
// too (docs/PRD.md C3). Visibility still decides whether the app counts as focused. Switching
// tabs fires both events, so one refresh per second is enough.
const REFOCUS_GAP_MS = 1000;
focusManager.setEventListener((handleFocus) => {
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

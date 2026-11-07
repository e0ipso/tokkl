// Reapplies the cached theme that packages/web/public/theme-boot.js set before the first paint.
import './lib/theme.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.tsx';
import { createQueryClient } from './api/queryClient.ts';
import { OverlayStackProvider } from './components/overlayStack.tsx';
import { ToastProvider } from './components/Toast.tsx';
import './styles.css';

const queryClient = createQueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <OverlayStackProvider>
          <App />
        </OverlayStackProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

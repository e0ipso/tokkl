import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}

interface ToastApi {
  show: (message: string, options?: { kind?: 'info' | 'error'; action?: Toast['action']; durationMs?: number }) => void;
  error: (error: unknown) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);

  const show = useCallback<ToastApi['show']>((message, options = {}) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-3), { id, message, kind: options.kind ?? 'info', action: options.action }]);
    setTimeout(() => dismiss(id), options.durationMs ?? (options.action ? 8000 : 4000));
  }, [dismiss]);

  const error = useCallback((err: unknown) => {
    show(err instanceof Error ? err.message : String(err), { kind: 'error' });
  }, [show]);

  return (
    <ToastContext.Provider value={{ show, error }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <span>{toast.message}</span>
            {toast.action ? (
              <button type="button" className="link-button" onClick={() => { toast.action!.run(); dismiss(toast.id); }}>
                {toast.action.label}
              </button>
            ) : null}
            <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}

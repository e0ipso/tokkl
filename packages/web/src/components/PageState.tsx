import type { ReactNode } from 'react';
import { t } from '../i18n/messages.ts';
import { Icon } from './Icon.tsx';

/** The wrapper is the pending content's region, so it carries aria-busy. LoadError is an alert with a warning icon. */

export function Loading({ label = t('common.loading'), className }: { label?: string; className?: string }) {
  return (
    <div className={`page-state page-loading${className ? ` ${className}` : ''}`} aria-busy="true">
      <span className="page-state-spinner" aria-hidden="true" />
      <span role="status">{label}</span>
    </div>
  );
}

export function LoadError({
  message,
  onRetry,
  className,
  title,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <div className={`page-state page-error${className ? ` ${className}` : ''}`} role="alert">
      {title ? <h1 className="page-error-title">{title}</h1> : null}
      <p className="page-error-message">
        <Icon name="alert" className="error-icon" />
        <span>{message}</span>
      </p>
      {onRetry ? (
        <button type="button" className="button button-ghost" onClick={onRetry}>
          {t('common.tryAgain')}
        </button>
      ) : null}
    </div>
  );
}

/** Such as the entry list during "Show more days". */
export function BusyRegion({ busy, className, children }: { busy: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={className} aria-busy={busy || undefined}>
      {children}
    </div>
  );
}

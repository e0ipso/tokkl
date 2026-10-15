import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';

/**
 * Loading and error states shared by every page.
 *
 * Loading stands in for content that has not arrived yet. The wrapper is that content's region, so it
 * carries aria-busy; the label inside is a status message. LoadError shows what failed, as an alert,
 * with a "Try again" button when the caller can refetch. Its message carries a warning icon as well
 * as the danger colour; a full-page error passes a title, which renders as the page's h1.
 */

export function Loading({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={`page-state page-loading${className ? ` ${className}` : ''}`} aria-busy="true">
      <span className="page-state-spinner" aria-hidden="true" />
      <span role="status">{label}</span>
    </div>
  );
}

export function LoadError({ message, onRetry, className, title }: {
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
        <button type="button" className="button button-ghost" onClick={onRetry}>Try again</button>
      ) : null}
    </div>
  );
}

/** Marks content that stays on screen while more of it loads, such as the entry list during "Show more days". */
export function BusyRegion({ busy, className, children }: { busy: boolean; className?: string; children: ReactNode }) {
  return <div className={className} aria-busy={busy || undefined}>{children}</div>;
}

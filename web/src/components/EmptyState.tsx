import type { ReactNode } from 'react';

/** The wave under an empty state's icon. Textures are inline SVG only (docs/PRD.md, Visual direction). */
function Swell() {
  return (
    <svg className="empty-state-swell" width="96" height="8" viewBox="0 0 96 8" aria-hidden="true">
      <path
        d="M1 7c7 0 8-6 15-6s8 6 16 6 8-6 16-6 8 6 16 6 8-6 16-6 8 6 15 6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * What a list shows when it has nothing in it: an icon over a wave, a headline, a line on what to do
 * next and optional action buttons. Compact drops the art, for popovers and small panels.
 */
export function EmptyState({ icon, title, children, actions, compact = false, className }: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={`empty-state${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`}>
      {compact ? null : (
        <div className="empty-state-art" aria-hidden="true">
          {icon}
          <Swell />
        </div>
      )}
      <p className="empty-state-title">{title}</p>
      {children ? <p className="empty-state-body">{children}</p> : null}
      {actions ? <div className="empty-state-actions">{actions}</div> : null}
    </div>
  );
}

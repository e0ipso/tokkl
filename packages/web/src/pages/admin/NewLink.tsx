import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { useToast } from '../../components/Toast.tsx';
import { copyText } from '../../lib/clipboard.ts';
import { t } from '../../i18n/messages.ts';

/**
 * A new one-time link, such as an invite or a password reset link. The server returns it only once,
 * so it is gone after a reload.
 */
export function NewLink({
  link,
  label,
  copied,
  onDone,
  children,
}: {
  link: string;
  label: string;
  copied: string;
  onDone: () => void;
  children: ReactNode;
}) {
  const toast = useToast();
  const copy = () => {
    copyText(link, t('admin.copyFailed')).then(
      () => toast.show(copied),
      (error: unknown) => toast.error(error),
    );
  };
  return (
    <div className="settings-notice admin-new-link" role="status">
      <div className="admin-new-link-text">
        <p>{children}</p>
        <code className="token-value" aria-label={label}>
          {link}
        </code>
      </div>
      <div className="inline-controls">
        <button type="button" className="button button-ghost" onClick={copy}>
          <Icon name="copy" size={16} /> {t('admin.copyLink')}
        </button>
        <button type="button" className="button button-ghost" onClick={onDone}>
          {t('common.done')}
        </button>
      </div>
    </div>
  );
}
